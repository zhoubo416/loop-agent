import { isSameText } from '~/composables/useFormat'

export interface ActionSourceEvent {
  id: string
  type: string
  title: string
  content: string
}

export interface ActionSourceLike {
  event: ActionSourceEvent | null
  recommendation: { id: string; content: string } | null
  run: {
    id: string
    trigger_type: string
    created_at: string
    judgment: string | null
    observation: { id: string; type: string; content: string } | null
  } | null
}

export interface ActionSourceContent {
  trigger: string | null
  judgment: string | null
}

export interface ActionExecution {
  id: string
  status: string
  executor_type: string
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  started_at: string
  completed_at: string | null
}

export interface ActionRecommendation {
  id: string
  type: string
  content: string
  priority: string
  status: string
}

export interface ActionEvent {
  id: string
  type: string
  title: string
}

export interface ActionAnalysisItem {
  id: string
  status: string
  created_at: string
  judgment: string | null
  recommendations: ActionRecommendation[]
  events: ActionEvent[]
}

export interface ActionDocumentItem {
  id: string
  name: string
  source: 'upload' | 'url'
  mime_type: string | null
  file_url: string | null
  file_size: number | string | null
  extracted_chars: number
  parse_status: 'pending' | 'ok' | 'unsupported' | 'failed'
  parse_error: string | null
  created_at: string
}

/** 三个详情页共用的行动字段,各自再扩展 meeting_import / documents */
export interface ActionDetailBase {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  kind: string
  executor_type: string
  assignee_id: string | null
  due_at: string | null
  created_at: string
  completed_at: string | null
  executions: ActionExecution[]
  analysis: ActionAnalysisItem[]
  source: ActionSourceLike | null
}

/** 最近一次 completed 的执行产出,结果卡片和参会人展示共用 */
export function latestCompletedOutput(
  executions: ActionExecution[],
): Record<string, unknown> | null {
  return executions.find((item) => item.status === 'completed')?.output ?? null
}

export function participantsFromOutput(
  output: Record<string, unknown> | null | undefined,
): string[] {
  const value = output?.participants
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function eventText(event: ActionSourceEvent): string {
  return event.content && event.content !== event.title
    ? `${event.title}\n\n${event.content}`
    : event.title
}

/**
 * 来源卡片只保留页面头部没展示过的内容。
 * 观察、事件、建议可能是同一件事的复述,取第一条不重复的作为触发内容。
 */
export function actionSourceContent(
  source: ActionSourceLike | null | undefined,
  title?: string | null,
  description?: string | null,
): ActionSourceContent {
  const candidates = [
    source?.run?.observation?.content ?? null,
    source?.event ? eventText(source.event) : null,
    source?.recommendation?.content ?? null,
  ]
  const trigger =
    candidates.find(
      (value) => value && !isSameText(value, title) && !isSameText(value, description),
    ) ?? null

  return { trigger, judgment: source?.run?.judgment ?? null }
}
