import {
  AgentEngineError,
  type AgentEngine,
  type AgentToolContext,
} from '../engine.js'
import { parseAgentOutput } from '../output-validator.js'
import type { AgentInput, AgentOutput } from '../types.js'

export interface PiEngineOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxRetries: number
}

const MAX_TOOL_ROUNDS = 6

const SYSTEM_PROMPT = `你是 LOOP 系统中的 Agent Engine,只负责思考,不直接修改数据库。
你服务的是一个长期运行的 Project Agent,需要根据项目目标、当前状态、最近的观察和正在进行的行动做出判断。

只输出一个 JSON 对象,不要输出解释文字或 Markdown 代码块。结构如下:
{
  "judgment": "对当前情况的判断,一段话",
  "state_patch": {
    "current_stage": "当前阶段",
    "current_situation": "现在发生了什么",
    "open_issues": ["需要解决的问题"],
    "risks": ["风险"],
    "unknowns": ["未知项"]
  },
  "events": [{ "type": "事件类型", "title": "标题", "content": "内容" }],
  "actions": [{ "title": "行动标题", "description": "说明", "executor_type": "human", "priority": "high", "kind": "task" }],
  "recommendations": [{ "type": "next_step", "content": "建议内容", "priority": "medium", "requires_confirmation": true }],
  "memories": [{ "type": "decision", "content": "值得长期保留的信息" }]
}

要求:
- 只提出真正有依据的内容,不要为了填充字段而编造事件或行动。
- 不要重复已经存在且仍然有效的行动。
- actions 里的 kind 取值 task / meeting / document:开会、整理资料这类工作要标对 kind,完成时才能采到对应信息。
- 当你判断某个新事件意味着某个已有行动已经完成、失败或取消时,不要新建行动,
  而是在 actions 里输出 {"id": "已有行动ID", "status": "completed" 或 "failed" 或 "cancelled", "description": "一句话说明"}。
- 没有把握的字段直接省略,不要输出空数组之外的多余内容。
- 立场是帮项目往前推进,而不是简单复述用户说过的话。

当判断项目已经满足成功标准、没有未完成行动和未解决问题时,
可以输出一条 type 为 "completion" 的 recommendation,内容是为什么认为项目可以结束。
完成建议必须经过用户确认,不要直接标记完成。

你可以调用工具(get_project_state、create_action、complete_action)来读取状态或提出行动,
工具执行的结果会回传给你。需要创建行动时优先用工具,而不是重复罗列已经存在的行动。`

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
}

interface ChatResponse {
  content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/**
 * PI Agent Adapter。
 *
 * 设计文档里 PI Agent 的具体接口不属于 LOOP 的公共契约,因此这里把它实现为
 * “OpenAI 兼容的 Chat Completions 引擎”:只要把 AGENT_ENGINE_BASE_URL 指向
 * 真正的 PI 服务即可。转换逻辑集中在本文件,Runtime 不感知任何 PI 细节。
 */
export class PIAgentEngine implements AgentEngine {
  readonly name = 'pi'
  private readonly options: PiEngineOptions

  constructor(options: PiEngineOptions) {
    this.options = options
  }

  async run(input: AgentInput, tools?: AgentToolContext): Promise<AgentOutput> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(this.buildPIInput(input)) },
    ]

    let final: string
    if (tools && tools.descriptors.length > 0) {
      final = await this.runToolLoop(messages, tools)
    } else {
      final = await this.singleShot(messages)
    }
    return this.parsePIOutput(final)
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.options.apiKey) {
      return { ok: false, detail: '未配置 AGENT_ENGINE_API_KEY' }
    }
    return { ok: true, detail: `${this.options.baseUrl} · ${this.options.model}` }
  }

  /** AgentInput → PI 输入。PI 需要的字段在这里收敛,不外泄到 Runtime。 */
  private buildPIInput(input: AgentInput): Record<string, unknown> {
    return {
      run_id: input.runId,
      project: {
        name: input.project.name,
        objective: input.project.objective,
        description: input.project.description,
        success_criteria: input.project.successCriteria,
        constraints: input.project.constraints,
        status: input.project.status,
      },
      current_state: input.state,
      trigger: input.trigger,
      recent_observations: input.observations,
      recent_events: input.events,
      active_actions: input.activeActions,
      recent_results: input.recentResults,
      memories: input.memories,
      instruction:
        '根据上面的项目上下文,判断项目当前处于什么状态,并给出这次运行应该产生的变化。',
    }
  }

  private async singleShot(messages: ChatMessage[]): Promise<string> {
    try {
      const response = await this.chat(messages, { jsonMode: true })
      if (response.content !== undefined) return response.content
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回内容', {
        retryable: true,
      })
    } catch (error) {
      // 部分 Engine 不支持 response_format=json_object,退回纯提示词模式再试一次
      if (error instanceof AgentEngineError && error.code === 'ENGINE_FORMAT_UNSUPPORTED') {
        const response = await this.chat(messages, { jsonMode: false })
        if (response.content !== undefined) return response.content
      }
      throw error
    }
  }

  private async runToolLoop(messages: ChatMessage[], tools: AgentToolContext): Promise<string> {
    const toolSpecs = tools.descriptors.map((descriptor) => ({
      type: 'function',
      function: {
        name: descriptor.name,
        description: descriptor.description,
        parameters: descriptor.parameters,
      },
    }))

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.chat(messages, { tools: toolSpecs })
      if (response.content !== undefined) return response.content

      const toolCalls = response.tool_calls ?? []
      if (toolCalls.length === 0) {
        throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回内容或工具调用', {
          retryable: true,
        })
      }

      messages.push({ role: 'assistant', content: null, tool_calls: toolCalls })
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          args = {}
        }
        let result: unknown
        try {
          result = await tools.execute(call.function.name, args)
        } catch (error) {
          result = { error: (error as Error).message }
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result ?? {}),
        })
      }
    }

    throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 的工具调用超过轮次上限', {
      retryable: false,
    })
  }

  private async chat(
    messages: ChatMessage[],
    options: { jsonMode?: boolean; tools?: unknown[] } = {},
  ): Promise<ChatResponse> {
    let lastError: AgentEngineError | undefined
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        return await this.chatOnce(messages, options)
      } catch (error) {
        if (!(error instanceof AgentEngineError) || !error.retryable) throw error
        lastError = error
        if (attempt < this.options.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        }
      }
    }
    throw lastError ?? new AgentEngineError('ENGINE_EXECUTION_ERROR', 'PI Agent 调用失败')
  }

  private async chatOnce(
    messages: ChatMessage[],
    options: { jsonMode?: boolean; tools?: unknown[] },
  ): Promise<ChatResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.2,
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          ...(options.tools ? { tools: options.tools } : {}),
          messages,
        }),
        signal: controller.signal,
      })

      if (response.status === 401 || response.status === 403) {
        throw new AgentEngineError('ENGINE_AUTH_ERROR', 'PI Agent 鉴权失败', { retryable: false })
      }
      if (response.status === 429) {
        throw new AgentEngineError('ENGINE_RATE_LIMITED', 'PI Agent 触发限流', { retryable: true })
      }
      if (response.status >= 500) {
        throw new AgentEngineError('ENGINE_UNAVAILABLE', `PI Agent 返回 ${response.status}`, {
          retryable: true,
        })
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        if (response.status === 400 && body.includes('response_format')) {
          throw new AgentEngineError('ENGINE_FORMAT_UNSUPPORTED', '该 Engine 不支持 JSON 输出模式', {
            retryable: false,
            details: body,
          })
        }
        throw new AgentEngineError('ENGINE_EXECUTION_ERROR', `PI Agent 返回 ${response.status}`, {
          retryable: false,
          details: body,
        })
      }

      const body = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string
            reasoning_content?: string
            tool_calls?: ChatResponse['tool_calls']
          }
        }>
      }
      const message = body.choices?.[0]?.message
      if (message?.tool_calls?.length) return { tool_calls: message.tool_calls }
      const content = message?.content || message?.reasoning_content
      if (!content) {
        throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回内容', {
          retryable: true,
        })
      }
      return { content }
    } catch (error) {
      if (error instanceof AgentEngineError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AgentEngineError('ENGINE_TIMEOUT', 'PI Agent 调用超时', { retryable: true })
      }
      throw new AgentEngineError('ENGINE_UNAVAILABLE', `PI Agent 调用失败:${String(error)}`, {
        retryable: true,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** PI 输出 → LOOP AgentOutput,格式变化只需要改这里 */
  private parsePIOutput(result: string): AgentOutput {
    return parseAgentOutput(stripCodeFence(result)).output
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  if (fenced?.[1]) return fenced[1]
  return trimmed
}
