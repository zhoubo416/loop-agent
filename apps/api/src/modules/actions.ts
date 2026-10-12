import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'
import { getMeetingSync, type MeetingSyncRow } from './meeting-sync.js'

export type ActionKind = 'task' | 'meeting' | 'document'

export interface ActionRow extends Row {
  id: string
  project_id: string
  event_id: string | null
  agent_run_id: string | null
  recommendation_id: string | null
  title: string
  description: string | null
  executor_type: string
  assignee_id: string | null
  status: string
  priority: string
  kind: string
  due_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  completed_at: Date | string | null
}

export interface CreateActionInput {
  projectId: string
  title: string
  description?: string | null
  executorType?: 'human' | 'agent' | 'system'
  assigneeId?: string | null
  priority?: 'low' | 'medium' | 'high' | 'critical'
  dueAt?: string | null
  eventId?: string | null
  agentRunId?: string | null
  recommendationId?: string | null
  status?: 'pending' | 'proposed'
  kind?: ActionKind
}

export async function insertAction(db: Db, input: CreateActionInput): Promise<ActionRow> {
  const result = await db.query<ActionRow>(
    `INSERT INTO actions
       (project_id, event_id, agent_run_id, recommendation_id, title, description,
        executor_type, assignee_id, status, priority, due_at, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $11, $9, $10::timestamptz, $12)
     RETURNING *`,
    [
      input.projectId,
      input.eventId ?? null,
      input.agentRunId ?? null,
      input.recommendationId ?? null,
      input.title,
      input.description ?? null,
      input.executorType ?? 'human',
      input.assigneeId ?? null,
      input.priority ?? 'medium',
      input.dueAt ?? null,
      input.status ?? 'pending',
      input.kind ?? 'task',
    ],
  )
  return result.rows[0]!
}

export async function getAction(db: Db, projectId: string, actionId: string): Promise<ActionRow> {
  const result = await db.query<ActionRow>(
    'SELECT * FROM actions WHERE id = $1 AND project_id = $2',
    [actionId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('ACTION_NOT_FOUND', 'Action 不存在')
  return row
}

export async function getActionMeetingSync(
  db: Db,
  projectId: string,
  actionId: string,
): Promise<MeetingSyncRow | null> {
  const action = await getAction(db, projectId, actionId)
  if (action.kind !== 'meeting') return null
  return getMeetingSync(db, action.id)
}

export interface ListActionsQuery {
  status?: string
  executorType?: string
  priority?: string
  assigneeId?: string
  limit?: number
}

export async function listActions(
  db: Db,
  projectId: string,
  query: ListActionsQuery = {},
): Promise<ActionRow[]> {
  const params: unknown[] = [projectId]
  const conditions = ['project_id = $1']
  if (query.status) {
    params.push(query.status)
    conditions.push(`status = $${params.length}`)
  }
  if (query.executorType) {
    params.push(query.executorType)
    conditions.push(`executor_type = $${params.length}`)
  }
  if (query.priority) {
    params.push(query.priority)
    conditions.push(`priority = $${params.length}`)
  }
  if (query.assigneeId) {
    params.push(query.assigneeId)
    conditions.push(`assignee_id = $${params.length}`)
  }
  params.push(query.limit ?? 100)
  const result = await db.query<ActionRow>(
    `SELECT * FROM actions WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return result.rows
}

export async function listOpenActions(db: Db, projectId: string): Promise<ActionRow[]> {
  const result = await db.query<ActionRow>(
    `SELECT * FROM actions
     WHERE project_id = $1 AND status IN ('pending', 'running')
     ORDER BY created_at`,
    [projectId],
  )
  return result.rows
}

export interface ActionAnalysisItem {
  id: string
  status: string
  created_at: Date | string
  judgment: string | null
  recommendations: Array<{
    id: string
    type: string
    content: string
    priority: string
    status: string
  }>
  events: Array<{ id: string; type: string; title: string }>
}

/**
 * 追溯一次 Action 完成后智能体后续的分析结论。
 * 完成 Action 会写一条 Observation(metadata.action_id),随后触发 Agent Run;
 * 这里沿着 observation → agent_run → recommendation/event 把判断带出来。
 */
export async function getActionAnalysis(
  db: Db,
  projectId: string,
  actionId: string,
): Promise<ActionAnalysisItem[]> {
  const runs = await db.query<{
    id: string
    status: string
    created_at: Date | string
    output: { judgment?: string | null } | null
  }>(
    `SELECT r.id, r.status, r.created_at, r.output
     FROM agent_runs r
     WHERE r.trigger_type = 'observation'
       AND r.trigger_id IN (
         SELECT o.id FROM observations o
         WHERE o.project_id = $2 AND o.metadata->>'action_id' = $1
       )
     ORDER BY r.created_at`,
    [actionId, projectId],
  )

  const items: ActionAnalysisItem[] = []
  for (const run of runs.rows) {
    const [recommendations, events] = await Promise.all([
      db.query<{ id: string; type: string; content: string; priority: string; status: string }>(
        `SELECT id, type, content, priority, status
         FROM recommendations WHERE agent_run_id = $1 ORDER BY created_at`,
        [run.id],
      ),
      db.query<{ id: string; type: string; title: string }>(
        `SELECT id, type, title FROM events WHERE agent_run_id = $1 ORDER BY occurred_at`,
        [run.id],
      ),
    ])
    items.push({
      id: run.id,
      status: run.status,
      created_at: run.created_at,
      judgment: run.output?.judgment ?? null,
      recommendations: recommendations.rows,
      events: events.rows,
    })
  }
  return items
}

export interface ActionSourceResult {
  event: { id: string; type: string; title: string; content: string } | null
  recommendation: { id: string; content: string } | null
  run: {
    id: string
    trigger_type: string
    created_at: Date | string
    judgment: string | null
    observation: { id: string; type: string; content: string } | null
  } | null
}

/**
 * 追溯一个 Action 的“来源”:它是由哪个事件、哪条建议、哪次智能体运行产生的。
 * 对应 docs/design/05 第 14 节“重点展示为什么产生这个 Action”。
 */
export async function getActionSource(
  db: Db,
  projectId: string,
  action: ActionRow,
): Promise<ActionSourceResult> {
  const source: ActionSourceResult = { event: null, recommendation: null, run: null }

  if (action.event_id) {
    const event = await db.query<{ id: string; type: string; title: string; content: string }>(
      'SELECT id, type, title, content FROM events WHERE id = $1 AND project_id = $2',
      [action.event_id, projectId],
    )
    source.event = event.rows[0] ?? null
  }

  if (action.recommendation_id) {
    const recommendation = await db.query<{ id: string; content: string }>(
      'SELECT id, content FROM recommendations WHERE id = $1 AND project_id = $2',
      [action.recommendation_id, projectId],
    )
    source.recommendation = recommendation.rows[0] ?? null
  }

  if (action.agent_run_id) {
    const run = await db.query<{
      id: string
      trigger_type: string
      trigger_id: string | null
      created_at: Date | string
      output: { judgment?: string | null } | null
    }>('SELECT id, trigger_type, trigger_id, created_at, output FROM agent_runs WHERE id = $1', [
      action.agent_run_id,
    ])
    const row = run.rows[0]
    if (row) {
      let observation: { id: string; type: string; content: string } | null = null
      if (row.trigger_type === 'observation' && row.trigger_id) {
        const obs = await db.query<{ id: string; type: string; content: string }>(
          'SELECT id, type, content FROM observations WHERE id = $1',
          [row.trigger_id],
        )
        observation = obs.rows[0] ?? null
      }
      source.run = {
        id: row.id,
        trigger_type: row.trigger_type,
        created_at: row.created_at,
        judgment: row.output?.judgment ?? null,
        observation,
      }
    }
  }

  return source
}

export async function listProposedActions(db: Db, projectId: string): Promise<ActionRow[]> {
  const result = await db.query<ActionRow>(
    `SELECT * FROM actions
     WHERE project_id = $1 AND status = 'proposed'
     ORDER BY created_at`,
    [projectId],
  )
  return result.rows
}

export interface UpdateActionInput {
  title?: string
  description?: string | null
  assigneeId?: string | null
  priority?: 'low' | 'medium' | 'high' | 'critical'
  dueAt?: string | null
}

export async function updateAction(db: Db, actionId: string, input: UpdateActionInput) {
  const sets: string[] = []
  const params: unknown[] = [actionId]
  const push = (column: string, value: unknown, cast = '') => {
    params.push(value)
    sets.push(`${column} = $${params.length}${cast}`)
  }
  if (input.title !== undefined) push('title', input.title)
  if (input.description !== undefined) push('description', input.description)
  if (input.assigneeId !== undefined) push('assignee_id', input.assigneeId)
  if (input.priority !== undefined) push('priority', input.priority)
  if (input.dueAt !== undefined) push('due_at', input.dueAt, '::timestamptz')
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  await db.query(`UPDATE actions SET ${sets.join(', ')} WHERE id = $1`, params)
}

export async function setActionStatus(
  db: Db,
  actionId: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'proposed',
): Promise<ActionRow> {
  const result = await db.query<ActionRow>(
    `UPDATE actions
     SET status = $2::varchar,
         updated_at = now(),
         completed_at = CASE WHEN $2::varchar IN ('completed', 'failed', 'cancelled')
                             THEN now() ELSE completed_at END
     WHERE id = $1
     RETURNING *`,
    [actionId, status],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('ACTION_NOT_FOUND', 'Action 不存在')
  return row
}

export async function confirmAction(db: Db, actionId: string): Promise<ActionRow> {
  const current = await db.query<ActionRow>('SELECT * FROM actions WHERE id = $1', [actionId])
  if (!current.rows[0]) throw new ApiError('ACTION_NOT_FOUND', 'Action 不存在')
  if (current.rows[0].status !== 'proposed') {
    throw new ApiError('ACTION_INVALID_STATE', '只有待确认的 Action 才能确认')
  }
  return setActionStatus(db, actionId, 'pending')
}

export async function declineAction(db: Db, actionId: string): Promise<ActionRow> {
  const current = await db.query<ActionRow>('SELECT * FROM actions WHERE id = $1', [actionId])
  if (!current.rows[0]) throw new ApiError('ACTION_NOT_FOUND', 'Action 不存在')
  if (current.rows[0].status !== 'proposed') {
    throw new ApiError('ACTION_INVALID_STATE', '只有待确认的 Action 才能拒绝')
  }
  return setActionStatus(db, actionId, 'cancelled')
}
