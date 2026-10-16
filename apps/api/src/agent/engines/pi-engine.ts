import {
  AgentEngineError,
  type AgentEngine,
  type AgentToolContext,
  type ConverseDeltaKind,
  type ConverseOptions,
} from '../engine.js'
import { parseAgentOutput, parseOrganizeOutput } from '../output-validator.js'
import type {
  AgentInput,
  AgentOutput,
  ConversationInput,
  OrganizeInput,
  OrganizeOutput,
} from '../types.js'

export interface PiEngineOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxRetries: number
}

const MAX_TOOL_ROUNDS = 6

const CHAT_SYSTEM_PROMPT = `你是 LOOP 项目里的研究讨论助手,服务于一个长期运行的项目智能体。
你在和项目负责人就项目本身进行讨论:回答问题、分析原因、给出你的看法。

要求:
- 基于项目实际情况回答,不知道就明确说不知道,不要编造。
- 回答用简体中文,先说结论和依据,保持自然的研究讨论语气。
- 不要在对话里承诺执行项目变更(创建行动、修改状态等);那属于系统的思考阶段,会自动进行。`

const SYSTEM_PROMPT = `你是 LOOP 系统中的 Agent Engine,只负责思考,不直接修改数据库。
你服务的是一个长期运行的 Project Agent,需要根据项目目标、当前状态、最近的观察和正在进行的行动做出判断。

只输出一个 JSON 对象,不要输出解释文字或 Markdown 代码块。结构如下:
{
  "judgment": "为什么产出下面这些变更,一句话;没有变更时说明为什么不用记录",
  "state_patch": {
    "current_stage": "当前阶段",
    "current_situation": "现在发生了什么,两三句话",
    "open_issues": ["还需要跟踪的问题"],
    "risks": ["风险"],
    "unknowns": ["未知项"]
  },
  "events": [{ "type": "事件类型", "title": "标题", "content": "一句话说明" }],
  "actions": [{ "title": "行动标题", "description": "一句话说明", "executor_type": "human", "priority": "high", "kind": "task" }],
  "recommendations": [{ "type": "next_step", "content": "一句话建议", "priority": "medium", "requires_confirmation": true }],
  "memories": [{ "type": "decision", "content": "值得长期保留的信息" }]
}

要求:
- 写短。用户需要知道的只有两件事:为什么产生这些变更,产生了什么:
  judgment 一句话说清依据和结论,不超过 40 字;
  事件和行动的标题不超过 20 字,说明各一句话;
  建议、开放问题、风险、未知项各一句话,不超过 40 字;
  current_situation 两三句话说完,不要写成报告。
- 不复述用户已经知道的信息,不把同一件事在 judgment 和具体条目里各说一遍,不交代分析过程。
- open_issues、risks、unknowns 是整体覆盖:只留还需要跟踪的,已经解决或不再重要的移出去,只保留最值得跟踪的几条;和现状没有差别时不要输出这几个字段。
- 宁缺毋滥:只有当输入包含对项目有实际价值的新信息(新进展、新问题、新决定、新结论)时,才产出事件、行动、建议和状态变更;寒暄、澄清、没有新信息的讨论只给 judgment,其余字段全部省略。
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

  async converse(input: ConversationInput, options: ConverseOptions = {}): Promise<string> {
    const messages = this.buildConversationMessages(input)

    if (!options.onDelta) {
      const response = await this.chat(messages)
      if (response.content !== undefined) return response.content
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回对话内容', {
        retryable: true,
      })
    }

    return this.chatStream(messages, options.onDelta)
  }

  /** 对话模式的输入与历史消息 */
  private buildConversationMessages(input: ConversationInput): ChatMessage[] {
    const projectLines = [
      `项目名称:${input.project.name}`,
      `项目目标:${input.project.objective}`,
      ...(input.project.description ? [`项目描述:${input.project.description}`] : []),
      ...(input.state.currentStage ? [`当前阶段:${input.state.currentStage}`] : []),
      ...(input.state.currentSituation ? [`当前情况:${input.state.currentSituation}`] : []),
      ...(input.state.openIssues.length
        ? [`开放问题:${input.state.openIssues.join(';')}`]
        : []),
    ]
    if (input.documents?.length) {
      projectLines.push(
        `用户当前正在讨论的资料如下,回答时基于资料内容,不要编造资料里没有的信息:`,
        ...input.documents.map((doc) => `《${doc.name}》\n${doc.text}`),
      )
    }
    return [
      { role: 'system', content: `${CHAT_SYSTEM_PROMPT}\n\n${projectLines.join('\n')}` },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: input.question },
    ]
  }

  async organize(input: OrganizeInput): Promise<OrganizeOutput> {
    const systemPrompt = `你是 LOOP 系统中的 Agent Engine,负责把项目资料整理成结构化结论。
用户会把资料行动的说明和若干文档的文本交给你,你需要整理成可以直接提交给项目智能体的草稿。

只输出一个 JSON 对象,不要输出解释文字或 Markdown 代码块。结构如下:
{
  "summary": "一句话结论,概括这份资料说明了什么",
  "key_points": ["要点,每条一句话"],
  "content": "整理后的正文,可以是分段的说明或数据汇总"
}

要求:
- 只基于资料文本里的实际内容整理,不要编造资料里没有的信息。
- 文本过短或信息有限时,如实概括已有的部分,key_points 可以为空数组。
- 用简体中文输出,保持信息密度,不要空话。`

    const userPayload = {
      action: input.action,
      documents: input.documents.map((doc) => ({ name: doc.name, text: doc.text })),
      ...(input.instruction ? { instruction: input.instruction } : {}),
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ]
    const result = await this.singleShot(messages)
    return parseOrganizeOutput(stripCodeFence(result))
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

  /**
   * 流式对话:上游按 SSE 逐块返回,每收到一段文本就回调一次,返回值是完整的回复。
   *
   * 上游有两种情况会退回非流式:明确拒绝 stream 参数(报错),或者干脆忽略它、直接返回一个
   * 完整的 JSON 响应。这两种情况下整段回复当作一个增量交出去。
   * 重试只在还没有内容回调出去的时候做:已经显示给用户的内容收不回来。
   */
  private async chatStream(
    messages: ChatMessage[],
    emit: (text: string, kind: ConverseDeltaKind) => void,
  ): Promise<string> {
    let emitted = false
    const delta = (text: string, kind: ConverseDeltaKind) => {
      if (!text) return
      emitted = true
      emit(text, kind)
    }

    let lastError: AgentEngineError | undefined
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        return await this.streamOnce(messages, delta)
      } catch (error) {
        if (!(error instanceof AgentEngineError)) throw error
        if (error.code === 'ENGINE_FORMAT_UNSUPPORTED') {
          const response = await this.chat(messages)
          if (response.content === undefined) {
            throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回对话内容', {
              retryable: true,
            })
          }
          delta(response.content, 'content')
          return response.content
        }
        if (!error.retryable || emitted) throw error
        lastError = error
        if (attempt < this.options.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        }
      }
    }
    throw lastError ?? new AgentEngineError('ENGINE_EXECUTION_ERROR', 'PI Agent 调用失败')
  }

  private async streamOnce(
    messages: ChatMessage[],
    emit: (text: string, kind: ConverseDeltaKind) => void,
  ): Promise<string> {
    const controller = new AbortController()
    // 流式的超时按"多久没有新内容"算:只要上游还在持续产出,就不算超时
    let timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    }

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
          stream: true,
          messages,
        }),
        signal: controller.signal,
      })

      const failure = await this.httpError(response)
      if (failure) throw failure

      // 端点忽略了 stream 参数:按非流式解析,整段回复作为一个增量
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const parsed = this.parseCompletion(await response.json())
        if (parsed.content === undefined) {
          throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回对话内容', {
            retryable: true,
          })
        }
        emit(parsed.content, 'content')
        return parsed.content
      }
      if (!response.body) {
        throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回流式响应体', {
          retryable: true,
        })
      }

      let content = ''
      let reasoning = ''
      for await (const data of readSseData(response.body)) {
        touch()
        if (data === '[DONE]') break
        let payload: {
          choices?: Array<{
            delta?: { content?: string | null; reasoning_content?: string | null }
          }>
        }
        try {
          payload = JSON.parse(data)
        } catch {
          continue // 单行解析不了就跳过,不因为一行坏数据丢掉整段回复
        }
        const piece = payload.choices?.[0]?.delta
        if (piece?.content) {
          content += piece.content
          emit(piece.content, 'content')
        }
        // 推理过程边收边发,标成 reasoning 交给前端单独展示,不算回复正文
        if (piece?.reasoning_content) {
          reasoning += piece.reasoning_content
          emit(piece.reasoning_content, 'reasoning')
        }
      }

      if (content) return content
      // 上游只给了推理、一个字正文都没有:整段推理当回复,否则用户等于什么都没拿到
      if (reasoning) return reasoning
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回对话内容', {
        retryable: true,
      })
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

  /** HTTP 状态码 → Engine 错误,正常响应返回 null。流式与非流式共用同一套判断。 */
  private async httpError(response: Response): Promise<AgentEngineError | null> {
    if (response.status === 401 || response.status === 403) {
      return new AgentEngineError('ENGINE_AUTH_ERROR', 'PI Agent 鉴权失败', { retryable: false })
    }
    if (response.status === 429) {
      return new AgentEngineError('ENGINE_RATE_LIMITED', 'PI Agent 触发限流', { retryable: true })
    }
    if (response.status >= 500) {
      return new AgentEngineError('ENGINE_UNAVAILABLE', `PI Agent 返回 ${response.status}`, {
        retryable: true,
      })
    }
    if (response.ok) return null

    const body = await response.text().catch(() => '')
    if (response.status === 400 && body.includes('response_format')) {
      return new AgentEngineError('ENGINE_FORMAT_UNSUPPORTED', '该 Engine 不支持 JSON 输出模式', {
        retryable: false,
        details: body,
      })
    }
    if (response.status === 400 && body.includes('stream')) {
      return new AgentEngineError('ENGINE_FORMAT_UNSUPPORTED', '该 Engine 不支持流式输出', {
        retryable: false,
        details: body,
      })
    }
    return new AgentEngineError('ENGINE_EXECUTION_ERROR', `PI Agent 返回 ${response.status}`, {
      retryable: false,
      details: body,
    })
  }

  /** 非流式响应体 → 统一的 ChatResponse */
  private parseCompletion(body: unknown): ChatResponse {
    const message = (
      body as {
        choices?: Array<{
          message?: {
            content?: string
            reasoning_content?: string
            tool_calls?: ChatResponse['tool_calls']
          }
        }>
      }
    )?.choices?.[0]?.message
    if (message?.tool_calls?.length) return { tool_calls: message.tool_calls }
    const content = message?.content || message?.reasoning_content
    if (!content) {
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'PI Agent 没有返回内容', {
        retryable: true,
      })
    }
    return { content }
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

      const failure = await this.httpError(response)
      if (failure) throw failure

      return this.parseCompletion(await response.json())
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

/**
 * 把上游的 SSE 响应体读成一个个 data 负载。
 * 事件之间用空行分隔,一个事件可以有多行 data,拼起来才是完整内容。
 */
async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      for (let match = /\r?\n\r?\n/.exec(buffer); match; match = /\r?\n\r?\n/.exec(buffer)) {
        const raw = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n')
        if (data) yield data
      }
    }
  } finally {
    // 调用方收完就 break(见到 [DONE])时,把上游连接一并释放
    await reader.cancel().catch(() => {})
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  if (fenced?.[1]) return fenced[1]
  return trimmed
}
