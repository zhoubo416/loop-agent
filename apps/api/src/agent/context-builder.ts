import type { Db } from '../db/client.js'
import type { AgentRunRow } from '../modules/runs.js'
import { listOpenActions, type ActionRow } from '../modules/actions.js'
import { listEvents } from '../modules/events.js'
import { listRecentExecutions } from '../modules/executions.js'
import { listMemories } from '../modules/memories.js'
import { listObservations } from '../modules/observations.js'
import { listMessages } from '../modules/sessions.js'
import { getState } from '../modules/states.js'
import { config } from '../config.js'
import type {
  AgentInput,
  ConversationInput,
  DocumentContextInput,
  OrganizeInput,
} from './types.js'
import { ApiError } from '../http/errors.js'

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function asStringArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Context Builder 只负责回答“应该把什么交给 Agent”。
 * 它不做任何 Engine 相关的格式转换,对应 docs/design/03-agent-runtime.md 第 13/14 节。
 */
export async function buildAgentInput(db: Db, run: AgentRunRow): Promise<AgentInput> {
  const projectResult = await db.query<{
    id: string
    name: string
    objective: string
    description: string | null
    success_criteria: unknown
    constraints: unknown
    status: string
    current_stage: string | null
  }>('SELECT * FROM projects WHERE id = $1', [run.project_id])
  const project = projectResult.rows[0]
  if (!project) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')

  const state = await getState(db, run.project_id)
  const [observations, events, activeActions, recentExecutions, memories] = await Promise.all([
    listObservations(db, run.project_id, { limit: 10 }),
    listEvents(db, run.project_id, { limit: 10 }),
    listOpenActions(db, run.project_id),
    listRecentExecutions(db, run.project_id, 5),
    listMemories(db, run.project_id, { status: 'active', limit: 10 }),
  ])

  const triggerPayload = { ...(run.input_context ?? {}) } as Record<string, unknown>
  if (run.trigger_id) triggerPayload.trigger_id = run.trigger_id

  return {
    project: {
      id: project.id,
      name: project.name,
      objective: project.objective,
      ...(project.description ? { description: project.description } : {}),
      successCriteria: project.success_criteria,
      constraints: project.constraints,
      status: project.status,
      ...(project.current_stage ? { currentStage: project.current_stage } : {}),
    },
    state: {
      ...(state.current_stage ? { currentStage: state.current_stage } : {}),
      ...(state.current_situation ? { currentSituation: state.current_situation } : {}),
      openIssues: asStringArray(state.open_issues),
      activeActions: asStringArray(state.active_actions),
      risks: asStringArray(state.risks),
      unknowns: asStringArray(state.unknowns),
      context: state.context ?? {},
      version: state.version,
    },
    observations: observations.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      ...(row.source ? { source: row.source } : {}),
      createdAt: iso(row.created_at)!,
      metadata: row.metadata ?? {},
    })),
    events: events.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      occurredAt: iso(row.occurred_at)!,
    })),
    activeActions: activeActions.map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.description ? { description: row.description } : {}),
      executorType: row.executor_type,
      ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
      status: row.status,
      priority: row.priority,
      ...(row.due_at ? { dueAt: iso(row.due_at)! } : {}),
    })),
    recentResults: recentExecutions.map((row) => ({
      id: row.id,
      actionId: row.action_id,
      actionTitle: row.action_title,
      kind: row.action_kind,
      status: row.status,
      output: row.output ?? {},
      ...(row.completed_at ? { completedAt: iso(row.completed_at)! } : {}),
    })),
    memories: memories.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      ...(row.confidence !== null && row.confidence !== undefined
        ? { confidence: Number(row.confidence) }
        : {}),
      createdAt: iso(row.created_at)!,
    })),
    trigger: {
      type: run.trigger_type,
      ...(run.trigger_id ? { id: run.trigger_id } : {}),
      ...(run.trigger_type ? { source: run.trigger_type } : {}),
      payload: triggerPayload,
    },
    runId: run.id,
  }
}

/**
 * 对话模式的输入组装:只带研究讨论需要的背景,不带完整思考上下文。
 * 本次问题单独传,history 里不包含它。
 * 从资料页进入对话时传 documentId,把资料的提取文本一并带给 Engine。
 */
export async function buildConversationInput(
  db: Db,
  projectId: string,
  sessionId: string,
  question: string,
  documentId?: string,
): Promise<ConversationInput> {
  const projectResult = await db.query<{
    name: string
    objective: string
    description: string | null
  }>('SELECT name, objective, description FROM projects WHERE id = $1', [projectId])
  const project = projectResult.rows[0]
  if (!project) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')

  const state = await getState(db, projectId)
  const history = (await listMessages(db, sessionId, 20))
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }))

  return {
    project: {
      name: project.name,
      objective: project.objective,
      ...(project.description ? { description: project.description } : {}),
    },
    state: {
      ...(state.current_stage ? { currentStage: state.current_stage } : {}),
      ...(state.current_situation ? { currentSituation: state.current_situation } : {}),
      openIssues: asStringArray(state.open_issues).map(String),
    },
    history,
    question,
    ...(documentId ? { documents: await loadDocumentContext(db, projectId, documentId) } : {}),
  }
}

/**
 * AI 整理模式的输入组装:带上项目背景、行动说明和资料的全部文档文本。
 * 没有可解析文本时抛 DOCUMENT_NO_TEXT,由调用方转成对用户的提示。
 */
export async function buildOrganizeInput(
  db: Db,
  projectId: string,
  action: ActionRow,
  instruction?: string,
): Promise<OrganizeInput> {
  const projectResult = await db.query<{ name: string; objective: string }>(
    'SELECT name, objective FROM projects WHERE id = $1',
    [projectId],
  )
  const project = projectResult.rows[0]
  if (!project) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')

  const documents = await loadDocumentContext(db, projectId, action.id)
  if (documents.length === 0) {
    throw new ApiError('DOCUMENT_NO_TEXT', '还没有可解析出文本的文档,先上传或导入资料')
  }

  return {
    project: { name: project.name, objective: project.objective },
    action: {
      title: action.title,
      ...(action.description ? { description: action.description } : {}),
    },
    documents,
    ...(instruction ? { instruction } : {}),
  }
}

/**
 * 资料文本上下文:按 action 取出所有解析成功的文档文本,
 * 合计截断到 documentContextMaxChars,保证进入模型的内容有界。
 */
async function loadDocumentContext(
  db: Db,
  projectId: string,
  actionId: string,
): Promise<DocumentContextInput[]> {
  const result = await db.query<{ name: string; extracted_text: string | null }>(
    `SELECT name, extracted_text FROM action_documents
     WHERE project_id = $1 AND action_id = $2 AND parse_status = 'ok'
     ORDER BY created_at, id`,
    [projectId, actionId],
  )
  const documents: DocumentContextInput[] = []
  let budget = config.documentContextMaxChars
  for (const row of result.rows) {
    if (budget <= 0) break
    const text = (row.extracted_text ?? '').trim()
    if (!text) continue
    const slice = text.slice(0, budget)
    budget -= slice.length
    documents.push({ name: row.name, text: slice })
  }
  return documents
}
