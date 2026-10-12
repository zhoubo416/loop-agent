/**
 * Agent Engine Adapter 的统一输入输出类型。
 * 对应设计文档 docs/design/07-agent-engine-adapter.md 第 4-18 节。
 *
 * Runtime 只依赖这些类型,不依赖任何具体 Engine(PI / OpenAI / Claude)。
 */

export interface ProjectContext {
  id: string
  name: string
  objective: string
  description?: string
  successCriteria: unknown
  constraints: unknown
  status: string
  currentStage?: string
}

export interface AgentStateContext {
  currentStage?: string
  currentSituation?: string
  openIssues: unknown[]
  activeActions: unknown[]
  risks: unknown[]
  unknowns: unknown[]
  context: Record<string, unknown>
  version: number
}

export interface ObservationContext {
  id: string
  type: string
  content: string
  source?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ActionContext {
  id: string
  title: string
  description?: string
  executorType: string
  assigneeId?: string
  status: string
  priority: string
  dueAt?: string
}

export interface EventContext {
  id: string
  type: string
  title: string
  content: string
  occurredAt: string
}

export interface ExecutionContext {
  id: string
  actionId: string
  actionTitle?: string
  kind?: string
  status: string
  output: Record<string, unknown>
  completedAt?: string
}

export interface MemoryContext {
  id: string
  type: string
  content: string
  confidence?: number
  createdAt: string
}

export interface TriggerContext {
  type: string
  id?: string
  source?: string
  payload?: Record<string, unknown>
}

export interface AgentInput {
  project: ProjectContext
  state: AgentStateContext
  observations: ObservationContext[]
  events: EventContext[]
  activeActions: ActionContext[]
  recentResults: ExecutionContext[]
  memories: MemoryContext[]
  trigger: TriggerContext
  runId: string
}

export interface StateProposal {
  currentStage?: string
  currentSituation?: string
  openIssues?: unknown[]
  activeActions?: unknown[]
  risks?: unknown[]
  unknowns?: unknown[]
  context?: Record<string, unknown>
}

export interface EventProposal {
  type: string
  title: string
  content: string
  occurredAt?: string
}

export interface ActionProposal {
  title?: string
  description?: string
  executorType?: 'human' | 'agent' | 'system'
  assigneeId?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  dueAt?: string
  eventIndex?: number
  kind?: 'task' | 'meeting' | 'document'
  /** 引用已有 Action:用于把一个新 Event 和进行中的 Action 关联起来 */
  id?: string
  status?: 'completed' | 'failed' | 'cancelled'
}

export interface RecommendationProposal {
  type: string
  content: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  requiresConfirmation?: boolean
}

export interface MemoryProposal {
  type: 'event' | 'decision' | 'action' | 'conclusion' | 'context'
  content: string
  confidence?: number
}

export interface AgentOutput {
  judgment?: string
  stateProposal?: StateProposal
  events?: EventProposal[]
  actions?: ActionProposal[]
  recommendations?: RecommendationProposal[]
  memories?: MemoryProposal[]
}
