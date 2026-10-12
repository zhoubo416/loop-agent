import type { Db } from '../db/client.js'
import type { AgentRunRow } from '../modules/runs.js'
import { listOpenActions } from '../modules/actions.js'
import { listEvents } from '../modules/events.js'
import { listRecentExecutions } from '../modules/executions.js'
import { listMemories } from '../modules/memories.js'
import { listObservations } from '../modules/observations.js'
import { getState } from '../modules/states.js'
import type { AgentInput } from './types.js'
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
