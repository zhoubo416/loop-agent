export type UiColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** 智能体常把标题和描述写成同一段话,去掉多余空白后比较,避免同一段内容展示多遍 */
export function isSameText(left?: string | null, right?: string | null): boolean {
  const normalize = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim()
  const normalizedLeft = normalize(left)
  return Boolean(normalizedLeft) && normalizedLeft === normalize(right)
}

/** 文件大小的人话显示,文档列表用 */
export function formatSize(value?: number | string | null): string {
  const size = typeof value === 'string' ? Number.parseInt(value, 10) : value
  if (!size || !Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** datetime-local 的输入值转成 ISO;空值和非法值返回 null */
export function localInputToIso(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/** 会议时长的人话显示,开始或结束时间缺失时返回空字符串 */
export function formatDuration(startedAt?: string | null, endedAt?: string | null): string {
  if (!startedAt || !endedAt) return ''
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  const minutes = Math.round((end - start) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

export const statusLabels: Record<string, string> = {
  created: '已创建',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
  pending: '待处理',
  proposed: '待确认',
  running: '进行中',
  failed: '失败',
  cancelled: '已取消',
  applied: '已应用',
  accepted: '已接受',
  rejected: '已拒绝',
  executed: '已转为行动',
  open: '未解决',
  resolved: '已解决',
}

export function statusLabel(status?: string | null): string {
  if (!status) return '—'
  return statusLabels[status] ?? status
}

export const kindLabels: Record<string, string> = {
  task: '任务',
  meeting: '会议',
  document: '资料',
}

export function kindLabel(kind?: string | null): string {
  if (!kind) return '任务'
  return kindLabels[kind] ?? kind
}

export function kindColor(kind?: string | null): UiColor {
  if (kind === 'meeting') return 'primary'
  if (kind === 'document') return 'success'
  return 'info'
}

export const priorityLabels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

export function priorityLabel(priority?: string | null): string {
  if (!priority) return '中'
  return priorityLabels[priority] ?? priority
}

export const executorLabels: Record<string, string> = {
  human: '人工',
  agent: '智能体',
  system: '系统',
}

export function executorLabel(executor?: string | null): string {
  if (!executor) return '人工'
  return executorLabels[executor] ?? executor
}

export function statusColor(status?: string | null): UiColor {
  switch (status) {
    case 'active':
    case 'completed':
    case 'resolved':
    case 'accepted':
      return 'success'
    case 'running':
    case 'executed':
      return 'info'
    case 'pending':
    case 'created':
    case 'paused':
    case 'proposed':
      return 'warning'
    case 'failed':
    case 'cancelled':
    case 'rejected':
      return 'error'
    default:
      return 'neutral'
  }
}

export function priorityColor(priority?: string | null): UiColor {
  switch (priority) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function severityColor(severity?: string | null): UiColor {
  switch (severity) {
    case 'critical':
      return 'error'
    case 'warning':
      return 'warning'
    default:
      return 'neutral'
  }
}

export const timelineTypeLabels: Record<string, string> = {
  observation: '观察',
  event: '事件',
  action: '行动',
  recommendation: '建议',
  execution: '执行',
}

export function actionDetailPath(
  projectId: string,
  action: { id: string; kind: string },
): string {
  const segment = action.kind === 'meeting' ? 'meetings' : action.kind === 'document' ? 'documents' : 'tasks'
  return `/projects/${projectId}/${segment}/${action.id}`
}

/** State 提案的人话摘要,概览与 Chat 思考结果共用 */
export function proposalSummary(proposal: Record<string, unknown>): string[] {
  const parts: string[] = []
  if (proposal.currentStage) parts.push(`阶段 → ${proposal.currentStage}`)
  const issues = proposal.openIssues
  if (Array.isArray(issues) && issues.length) parts.push(`开放问题 +${issues.length}`)
  const risks = proposal.risks
  if (Array.isArray(risks) && risks.length) parts.push(`风险 +${risks.length}`)
  const unknowns = proposal.unknowns
  if (Array.isArray(unknowns) && unknowns.length) parts.push(`未知项 +${unknowns.length}`)
  return parts.length ? parts : ['状态变更']
}
