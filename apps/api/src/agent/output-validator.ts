import { z } from 'zod'
import { AgentEngineError } from './engine.js'
import type {
  ActionProposal,
  AgentOutput,
  EventProposal,
  MemoryProposal,
  OrganizeOutput,
  RecommendationProposal,
  StateProposal,
} from './types.js'

const MAX_ITEMS = 20

export interface ParsedAgentOutput {
  output: AgentOutput
  warnings: string[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

/** 同时接受 camelCase 和 snake_case,Engine 之间不用互相迁就字段风格 */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function toText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  const record = asRecord(value)
  if (record) {
    const inner = pick(record, 'content', 'text', 'summary')
    if (typeof inner === 'string' && inner.trim() !== '') return inner.trim()
  }
  return undefined
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

const prioritySchema = z.enum(['low', 'medium', 'high', 'critical'])
const executorSchema = z.enum(['human', 'agent', 'system'])
const memoryTypeSchema = z.enum(['event', 'decision', 'action', 'conclusion', 'context'])

function parseStateProposal(raw: unknown): StateProposal | undefined {
  const record = asRecord(raw)
  if (!record) return undefined
  const proposal: StateProposal = {}
  const stage = pick(record, 'current_stage', 'currentStage')
  const situation = pick(record, 'current_situation', 'currentSituation')
  if (typeof stage === 'string') proposal.currentStage = stage
  if (typeof situation === 'string') proposal.currentSituation = situation
  const listFields: Array<[keyof StateProposal, string[]]> = [
    ['openIssues', ['open_issues', 'openIssues']],
    ['activeActions', ['active_actions', 'activeActions']],
    ['risks', ['risks']],
    ['unknowns', ['unknowns']],
  ]
  for (const [target, keys] of listFields) {
    const value = pick(record, ...keys)
    if (value !== undefined) {
      const items = toArray(value).slice(0, MAX_ITEMS)
      ;(proposal as Record<string, unknown>)[target] = items
    }
  }
  const context = pick(record, 'context')
  const contextRecord = asRecord(context)
  if (contextRecord) proposal.context = contextRecord
  return Object.keys(proposal).length > 0 ? proposal : undefined
}

function parseEvents(raw: unknown, warnings: string[]): EventProposal[] {
  const events: EventProposal[] = []
  for (const item of toArray(raw).slice(0, MAX_ITEMS)) {
    const record = asRecord(item)
    if (!record) {
      warnings.push('忽略了一个结构非法的 event')
      continue
    }
    const title = toText(pick(record, 'title', 'name'))
    const content = toText(pick(record, 'content', 'description')) ?? title
    const type = toText(pick(record, 'type', 'event_type', 'eventType')) ?? 'event'
    if (!title || !content) {
      warnings.push('忽略了一个缺少 title/content 的 event')
      continue
    }
    const occurredAt = toText(pick(record, 'occurred_at', 'occurredAt'))
    events.push({ type, title, content, ...(occurredAt ? { occurredAt } : {}) })
  }
  return events
}

function parseActions(raw: unknown, warnings: string[]): ActionProposal[] {
  const actions: ActionProposal[] = []
  for (const item of toArray(raw).slice(0, MAX_ITEMS)) {
    const record = asRecord(item)
    if (!record) {
      warnings.push('忽略了一个结构非法的 action')
      continue
    }
    const existingId = toText(pick(record, 'id', 'action_id', 'actionId'))
    const existingStatus = toText(pick(record, 'status'))
    const description = toText(pick(record, 'description'))
    // 引用已有 Action 完成关联时,title 可以省略
    if (
      existingId &&
      (existingStatus === 'completed' || existingStatus === 'failed' || existingStatus === 'cancelled')
    ) {
      actions.push({
        id: existingId,
        status: existingStatus,
        ...(description ? { description } : {}),
      })
      continue
    }
    const title = toText(pick(record, 'title', 'name', 'content'))
    if (!title) {
      warnings.push('忽略了一个缺少 title 的 action')
      continue
    }
    const executorRaw = pick(record, 'executor_type', 'executorType')
    const priorityRaw = pick(record, 'priority')
    const assigneeId = toText(pick(record, 'assignee_id', 'assigneeId'))
    const dueAt = toText(pick(record, 'due_at', 'dueAt'))
    const kind = toText(pick(record, 'kind'))
    const executor = executorSchema.safeParse(executorRaw)
    const priority = prioritySchema.safeParse(priorityRaw)
    if (executorRaw !== undefined && !executor.success) warnings.push(`action 的 executor_type 非法,已回退为 human:${title}`)
    if (priorityRaw !== undefined && !priority.success) warnings.push(`action 的 priority 非法,已回退为 medium:${title}`)
    actions.push({
      title,
      ...(description ? { description } : {}),
      executorType: executor.success ? executor.data : 'human',
      ...(assigneeId ? { assigneeId } : {}),
      priority: priority.success ? priority.data : 'medium',
      ...(dueAt ? { dueAt } : {}),
      ...(kind === 'task' || kind === 'meeting' || kind === 'document' ? { kind } : {}),
    })
  }
  return actions
}

function parseRecommendations(raw: unknown, warnings: string[]): RecommendationProposal[] {
  const recommendations: RecommendationProposal[] = []
  for (const item of toArray(raw).slice(0, MAX_ITEMS)) {
    const record = asRecord(item)
    if (!record) {
      warnings.push('忽略了一个结构非法的 recommendation')
      continue
    }
    const content = toText(pick(record, 'content', 'title', 'text'))
    if (!content) {
      warnings.push('忽略了一个缺少 content 的 recommendation')
      continue
    }
    const type = toText(pick(record, 'type')) ?? 'next_step'
    const priorityRaw = pick(record, 'priority')
    const requiresRaw = pick(record, 'requires_confirmation', 'requiresConfirmation')
    const priority = prioritySchema.safeParse(priorityRaw)
    recommendations.push({
      type,
      content,
      priority: priority.success ? priority.data : 'medium',
      requiresConfirmation: typeof requiresRaw === 'boolean' ? requiresRaw : true,
    })
  }
  return recommendations
}

function parseMemories(raw: unknown, warnings: string[]): MemoryProposal[] {
  const memories: MemoryProposal[] = []
  for (const item of toArray(raw).slice(0, MAX_ITEMS)) {
    const record = asRecord(item)
    if (!record) {
      warnings.push('忽略了一个结构非法的 memory')
      continue
    }
    const content = toText(pick(record, 'content', 'text'))
    if (!content) {
      warnings.push('忽略了一个缺少 content 的 memory')
      continue
    }
    const type = memoryTypeSchema.safeParse(pick(record, 'type'))
    const confidenceRaw = pick(record, 'confidence')
    const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : undefined
    memories.push({
      type: type.success ? type.data : 'context',
      content,
      ...(confidence !== undefined ? { confidence } : {}),
    })
  }
  return memories
}

/**
 * 解析 Engine 输出。
 * 结构性问题直接判为 ENGINE_INVALID_OUTPUT,交由 Runtime 决定重试或失败;
 * 单条内容的问题降级为 warning,避免一条噪音让整个 Run 失败。
 */
export function parseAgentOutput(raw: unknown): ParsedAgentOutput {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'Agent 输出不是合法 JSON', { retryable: true })
    }
  }
  const record = asRecord(value)
  if (!record) {
    throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'Agent 输出必须是 JSON 对象', { retryable: true })
  }

  const warnings: string[] = []
  const judgment = toText(pick(record, 'judgment', 'judgement'))
  const stateProposal = parseStateProposal(pick(record, 'state_patch', 'statePatch', 'state_proposal', 'stateProposal'))
  const events = parseEvents(pick(record, 'events'), warnings)
  const actions = parseActions(pick(record, 'actions'), warnings)
  const recommendations = parseRecommendations(pick(record, 'recommendations'), warnings)
  const memories = parseMemories(pick(record, 'memories'), warnings)

  const output: AgentOutput = {}
  if (judgment) output.judgment = judgment
  if (stateProposal) output.stateProposal = stateProposal
  if (events.length > 0) output.events = events
  if (actions.length > 0) output.actions = actions
  if (recommendations.length > 0) output.recommendations = recommendations
  if (memories.length > 0) output.memories = memories

  if (Object.keys(output).length === 0) {
    throw new AgentEngineError('ENGINE_INVALID_OUTPUT', 'Agent 输出没有任何可用字段', { retryable: true })
  }

  return { output, warnings }
}

/**
 * 解析 AI 整理模式的输出:summary / key_points / content 三个字段,
 * 兼容 camelCase 与 snake_case。要点缺失时降级为空列表,内容缺失降级为空串,
 * 只有 summary 完全没有才判为结构错误。
 */
export function parseOrganizeOutput(raw: unknown): OrganizeOutput {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new AgentEngineError('ENGINE_INVALID_OUTPUT', '整理结果不是合法 JSON', { retryable: true })
    }
  }
  const record = asRecord(value)
  if (!record) {
    throw new AgentEngineError('ENGINE_INVALID_OUTPUT', '整理结果必须是 JSON 对象', { retryable: true })
  }

  const summary = toText(pick(record, 'summary', 'conclusion'))
  if (!summary) {
    throw new AgentEngineError('ENGINE_INVALID_OUTPUT', '整理结果缺少 summary', { retryable: true })
  }

  const keyPointsRaw = pick(record, 'key_points', 'keyPoints', 'points')
  const keyPoints = toArray(keyPointsRaw)
    .map((item) => toText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_ITEMS)

  return { summary, keyPoints, content: toText(pick(record, 'content', 'detail')) ?? '' }
}
