import type { AgentEngine } from '../../src/agent/engine.js'
import type { AgentInput, AgentOutput, ConversationInput } from '../../src/agent/types.js'

const FAILURE_KEYWORDS = ['失败', '异常', '问题', '风险', '差很多']
const DONE_KEYWORDS = ['完成', '结束', '拿到']
const DECISION_KEYWORDS = ['决定', '确定', '结论']

function truncate(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

function contains(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

/**
 * 只用于测试的确定性 Agent Engine。
 *
 * 它不参与任何产品路径:运行时使用的 Engine 由 AGENT_ENGINE 配置决定。
 * 测试需要的是“输入固定时输出固定”,这样 Runtime 的状态流转、幂等和并发
 * 才能被精确断言。
 */
export class ScriptedEngine implements AgentEngine {
  readonly name = 'scripted-test-double'

  async converse(input: ConversationInput): Promise<string> {
    return `(scripted 讨论回复)关于「${input.question}」,结合当前项目状态,建议先核对已有记录再判断。`
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    if (input.trigger.type === 'manual') {
      const instruction = String(input.trigger.payload?.instruction ?? '')
      if (instruction.includes('完成')) {
        return {
          judgment: '当前项目没有未完成的行动和未解决的问题,建议确认完成。',
          recommendations: [
            {
              type: 'completion',
              content: '项目已达到完成条件,建议结束。',
              priority: 'high',
              requiresConfirmation: true,
            },
          ],
        }
      }
    }

    if (input.trigger.type === 'schedule') {
      const overdue = input.activeActions.filter(
        (action) => action.dueAt && new Date(action.dueAt).getTime() < Date.now(),
      )
      return {
        judgment: overdue.length
          ? `定时检查发现 ${overdue.length} 个 Action 已经超过计划时间。`
          : '定时检查完成,没有发现需要处理的问题。',
        ...(overdue.length
          ? {
              recommendations: [
                {
                  type: 'reminder',
                  content: `以下行动已经超过计划时间:${overdue.map((item) => item.title).join('、')}。`,
                  priority: 'high' as const,
                  requiresConfirmation: true,
                },
              ],
            }
          : {}),
      }
    }

    const observation = input.observations[0]
    if (!observation) return { judgment: '没有新的 Observation。' }

    const content = observation.content
    const summary = truncate(content)
    const isFailure = contains(content, FAILURE_KEYWORDS)
    const isDone = contains(content, DONE_KEYWORDS)
    const isDecision = contains(content, DECISION_KEYWORDS)

    // 宁缺毋滥:没有新信息的输入只给判断,不产出任何项目变更
    if (!isFailure && !isDone && !isDecision) {
      return { judgment: '这轮讨论没有带来需要记录的新信息。' }
    }

    const output: AgentOutput = {
      judgment: isFailure
        ? `记录到新的项目信息:${summary}。这条信息指向异常,需要先确认原因。`
        : `记录到新的项目信息:${summary}。`,
      events: [
        {
          type: isFailure ? 'issue_reported' : 'progress_completed',
          title: summary,
          content,
        },
      ],
      stateProposal: {
        currentSituation: summary,
        ...(isFailure ? { currentStage: '问题排查' } : { currentStage: '结果分析' }),
      },
    }

    if (isFailure) {
      output.recommendations = [
        {
          type: 'risk',
          content: `「${summary}」可能影响项目推进,建议先确认原因。`,
          priority: 'high',
          requiresConfirmation: true,
        },
      ]
      output.stateProposal!.openIssues = [...input.state.openIssues, summary]
      output.actions = [
        {
          title: `排查「${summary}」的原因`,
          description: '先定位问题原因,再决定下一步。',
          executorType: 'human',
          priority: 'high',
        },
      ]
    } else {
      output.recommendations = [
        {
          type: 'next_step',
          content: `建议整理「${summary}」的结果,并据此推进下一步。`,
          priority: 'medium',
          requiresConfirmation: true,
        },
      ]
      output.actions = [
        {
          title: `分析「${summary}」的结果`,
          description: '整理结果数据并得出结论。',
          executorType: 'human',
          priority: 'medium',
        },
      ]
    }

    if (isDecision) {
      output.memories = [{ type: 'decision', content: summary, confidence: 0.8 }]
    }
    return output
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: '仅用于测试' }
  }
}
