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

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 对话模式的输入:回答用户就项目提出的问题。
 * 它和思考(AgentInput)分开:对话只产生文本回复,项目变更由思考阶段处理。
 * 用户从资料页进入对话时,documents 携带当前讨论资料的提取文本。
 */
export interface ConversationInput {
  project: {
    name: string
    objective: string
    description?: string
  }
  state: {
    currentStage?: string
    currentSituation?: string
    openIssues: string[]
  }
  history: ConversationTurn[]
  question: string
  documents?: DocumentContextInput[]
}

/** 一份资料的提取文本,整理和对话共用 */
export interface DocumentContextInput {
  name: string
  text: string
}

/**
 * AI 整理模式的输入:把资料的文档文本整理成结构化草稿。
 * 与 run/converse 并列,是 Engine 的第三种模式;输出不落库,
 * 由用户修订后随 Action complete 提交。
 */
export interface OrganizeInput {
  project: {
    name: string
    objective: string
  }
  action: {
    title: string
    description?: string
  }
  documents: DocumentContextInput[]
  instruction?: string
}

export interface OrganizeOutput {
  summary: string
  keyPoints: string[]
  content: string
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
