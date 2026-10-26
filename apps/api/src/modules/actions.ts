import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

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

export interface ListActionsQuery {
  status?: string
  executorType?: string
  priority?: string
  assigneeId?: string
  kind?: string
  limit?: number
}

export interface ActionMeetingSummary {
  meeting_title: string | null
  started_at: Date | string | null
  ended_at: Date | string | null
  participants: string[]
  summary: string | null
  content_source: string
}

export interface ActionDocumentSummary {
  count: number
  names: string[]
  parsed_count: number
  unsupported_count: number
  failed_count: number
  extracted_chars: number
}

export interface ActionResultSummary {
  summary: string | null
  participants: string[]
}

/** 列表项:会议和资料类型额外带业务摘要,供各自列表页展示 */
export interface ActionListRow extends ActionRow {
  meeting?: ActionMeetingSummary | null
  documents?: ActionDocumentSummary | null
  result?: ActionResultSummary | null
}

export async function listActions(
  db: Db,
  projectId: string,
  query: ListActionsQuery = {},
): Promise<ActionListRow[]> {
  const params: unknown[] = [projectId]
  const conditions = ['a.project_id = $1']
  if (query.status) {
    params.push(query.status)
    conditions.push(`a.status = $${params.length}`)
  }
  if (query.executorType) {
    params.push(query.executorType)
    conditions.push(`a.executor_type = $${params.length}`)
  }
  if (query.priority) {
    params.push(query.priority)
    conditions.push(`a.priority = $${params.length}`)
  }
  if (query.assigneeId) {
    params.push(query.assigneeId)
    conditions.push(`a.assignee_id = $${params.length}`)
  }
  if (query.kind) {
    params.push(query.kind)
    conditions.push(`a.kind = $${params.length}`)
  }

  // 列表页要展示的内容摘要,只按 kind 拼对应的 join
  const selects = ['a.*']
  const joins: string[] = []
  if (query.kind === 'meeting') {
    selects.push(
      'mi.action_id IS NOT NULL AS has_meeting_import',
      'mi.meeting_title AS import_meeting_title',
      'mi.started_at AS import_started_at',
      'mi.ended_at AS import_ended_at',
      'mi.participants AS import_participants',
      'mi.summary AS import_summary',
      'mi.content_source AS import_content_source',
    )
    joins.push('LEFT JOIN action_meeting_imports mi ON mi.action_id = a.id')
  }
  if (query.kind === 'document') {
    selects.push(
      'docs.document_count',
      'docs.document_names',
      'docs.parsed_count',
      'docs.unsupported_count',
      'docs.failed_count',
      'docs.extracted_chars',
    )
    joins.push(`LEFT JOIN LATERAL (
      SELECT count(*)::int AS document_count,
             (array_agg(d.name ORDER BY d.created_at))[1:3] AS document_names,
             count(*) FILTER (WHERE d.parse_status = 'ok')::int AS parsed_count,
             count(*) FILTER (WHERE d.parse_status = 'unsupported')::int AS unsupported_count,
             count(*) FILTER (WHERE d.parse_status = 'failed')::int AS failed_count,
             coalesce(sum(length(d.extracted_text)), 0)::int AS extracted_chars
      FROM action_documents d WHERE d.action_id = a.id
    ) docs ON true`)
  }
  if (query.kind === 'meeting' || query.kind === 'document') {
    selects.push(
      'latest.output IS NOT NULL AS has_result',
      "latest.output->>'summary' AS result_summary",
      "latest.output->'participants' AS result_participants",
    )
    joins.push(`LEFT JOIN LATERAL (
      SELECT e.output FROM executions e
      WHERE e.action_id = a.id AND e.status = 'completed'
      ORDER BY e.completed_at DESC NULLS LAST, e.started_at DESC
      LIMIT 1
    ) latest ON true`)
  }

  params.push(query.limit ?? 100)
  const result = await db.query<Row>(
    `SELECT ${selects.join(', ')}
     FROM actions a
     ${joins.join('\n')}
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE a.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       a.created_at DESC
     LIMIT $${params.length}`,
    params,
  )

  const aliases = [
    'has_meeting_import',
    'import_meeting_title',
    'import_started_at',
    'import_ended_at',
    'import_participants',
    'import_summary',
    'import_content_source',
    'document_count',
    'document_names',
    'parsed_count',
    'unsupported_count',
    'failed_count',
    'extracted_chars',
    'has_result',
    'result_summary',
    'result_participants',
  ]
  return result.rows.map((row) => {
    const item = { ...row } as ActionListRow
    for (const key of aliases) delete item[key]

    if (query.kind === 'meeting') {
      item.meeting = row.has_meeting_import
        ? {
            meeting_title: (row.import_meeting_title as string | null) ?? null,
            started_at: (row.import_started_at as Date | string | null) ?? null,
            ended_at: (row.import_ended_at as Date | string | null) ?? null,
            participants: Array.isArray(row.import_participants)
              ? (row.import_participants as string[])
              : [],
            summary: (row.import_summary as string | null) ?? null,
            content_source: (row.import_content_source as string) ?? 'minutes',
          }
        : null
    }
    if (query.kind === 'document') {
      item.documents = {
        count: Number(row.document_count ?? 0),
        names: Array.isArray(row.document_names) ? (row.document_names as string[]) : [],
        parsed_count: Number(row.parsed_count ?? 0),
        unsupported_count: Number(row.unsupported_count ?? 0),
        failed_count: Number(row.failed_count ?? 0),
        extracted_chars: Number(row.extracted_chars ?? 0),
      }
    }
    if (query.kind === 'meeting' || query.kind === 'document') {
      item.result = row.has_result
        ? {
            summary: (row.result_summary as string | null) ?? null,
            participants: Array.isArray(row.result_participants)
              ? (row.result_participants as string[])
              : [],
          }
        : null
    }
    return item
  })
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
