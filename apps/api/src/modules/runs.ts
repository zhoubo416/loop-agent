import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface AgentRunRow extends Row {
  id: string
  project_id: string
  session_id: string | null
  trigger_type: string
  trigger_id: string | null
  input_context: Record<string, unknown>
  output: Record<string, unknown> | null
  status: string
  error: Record<string, unknown> | null
  attempts: number
  started_at: Date | string | null
  completed_at: Date | string | null
  created_at: Date | string
}

export interface CreateRunInput {
  projectId: string
  triggerType: string
  triggerId?: string | null
  sessionId?: string | null
  inputContext?: Record<string, unknown>
}

export async function insertRun(db: Db, input: CreateRunInput): Promise<AgentRunRow> {
  const result = await db.query<AgentRunRow>(
    `INSERT INTO agent_runs (project_id, session_id, trigger_type, trigger_id, input_context, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
     RETURNING *`,
    [
      input.projectId,
      input.sessionId ?? null,
      input.triggerType,
      input.triggerId ?? null,
      JSON.stringify(input.inputContext ?? {}),
    ],
  )
  return result.rows[0]!
}

export async function getRun(db: Db, projectId: string, runId: string): Promise<AgentRunRow> {
  const result = await db.query<AgentRunRow>(
    'SELECT * FROM agent_runs WHERE id = $1 AND project_id = $2',
    [runId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('RUN_NOT_FOUND', 'Agent Run 不存在')
  return row
}

export async function getRunById(db: Db, runId: string): Promise<AgentRunRow | undefined> {
  const result = await db.query<AgentRunRow>('SELECT * FROM agent_runs WHERE id = $1', [runId])
  return result.rows[0]
}

export interface ListRunsQuery {
  status?: string
  triggerType?: string
  page: number
  pageSize: number
}

export async function listRuns(
  db: Db,
  projectId: string,
  query: ListRunsQuery,
): Promise<{ items: AgentRunRow[]; total: number }> {
  const params: unknown[] = [projectId]
  let where = 'WHERE project_id = $1'
  if (query.status) {
    params.push(query.status)
    where += ` AND status = $${params.length}`
  }
  if (query.triggerType) {
    params.push(query.triggerType)
    where += ` AND trigger_type = $${params.length}`
  }
  const total = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agent_runs ${where}`,
    params,
  )
  params.push(query.pageSize, (query.page - 1) * query.pageSize)
  const items = await db.query<AgentRunRow>(
    `SELECT * FROM agent_runs ${where} ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { items: items.rows, total: Number.parseInt(total.rows[0]?.count ?? '0', 10) }
}

export async function listRunsBySession(
  db: Db,
  sessionId: string,
  limit = 8,
): Promise<AgentRunRow[]> {
  const result = await db.query<AgentRunRow>(
    `SELECT * FROM agent_runs WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, limit],
  )
  return result.rows
}

export async function hasRunningRun(
  db: Db,
  projectId: string,
  exceptRunId?: string,
): Promise<boolean> {
  const params: unknown[] = [projectId]
  let sql = `SELECT 1 FROM agent_runs WHERE project_id = $1 AND status = 'running'`
  if (exceptRunId) {
    params.push(exceptRunId)
    sql += ` AND id <> $${params.length}`
  }
  const result = await db.query(sql, params)
  return result.rows.length > 0
}

export async function completeRun(
  db: Db,
  runId: string,
  output: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE agent_runs
     SET status = 'completed', output = $2::jsonb, completed_at = now(), error = NULL
     WHERE id = $1`,
    [runId, JSON.stringify(output)],
  )
}

export async function failRun(
  db: Db,
  runId: string,
  error: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE agent_runs SET status = 'failed', error = $2::jsonb, completed_at = now() WHERE id = $1`,
    [runId, JSON.stringify(error)],
  )
}

export async function requeueRun(db: Db, runId: string): Promise<void> {
  await db.query(
    `UPDATE agent_runs SET status = 'pending', started_at = NULL WHERE id = $1 AND status = 'running'`,
    [runId],
  )
}

export async function cancelRun(db: Db, projectId: string, runId: string): Promise<AgentRunRow> {
  const run = await getRun(db, projectId, runId)
  if (run.status === 'completed' || run.status === 'failed') {
    throw new ApiError('RUN_CONFLICT', 'Agent Run 已经结束,无法取消')
  }
  const result = await db.query<AgentRunRow>(
    `UPDATE agent_runs SET status = 'cancelled', completed_at = now() WHERE id = $1 RETURNING *`,
    [runId],
  )
  return result.rows[0]!
}

/**
 * Worker 从 agent_runs 里认领一个待运行任务。
 * 用 FOR UPDATE SKIP LOCKED 避免多个 Worker 抢同一条记录。
 */
export async function claimNextRun(db: Db): Promise<AgentRunRow | undefined> {
  const result = await db.query<AgentRunRow>(
    `UPDATE agent_runs
     SET status = 'running', started_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM agent_runs
       WHERE status = 'pending'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
  )
  return result.rows[0]
}

export async function acquireProjectLock(
  db: Db,
  projectId: string,
  holder: string,
  agentRunId: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO project_locks (project_id, holder, agent_run_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)
     ON CONFLICT (project_id) DO UPDATE
       SET holder = EXCLUDED.holder,
           agent_run_id = EXCLUDED.agent_run_id,
           acquired_at = now(),
           expires_at = EXCLUDED.expires_at
       WHERE project_locks.expires_at < now()
     RETURNING project_id`,
    [projectId, holder, agentRunId, String(ttlMs)],
  )
  return result.rows.length > 0
}

export async function releaseProjectLock(
  db: Db,
  projectId: string,
  holder: string,
): Promise<void> {
  await db.query('DELETE FROM project_locks WHERE project_id = $1 AND holder = $2', [
    projectId,
    holder,
  ])
}

export async function listProjectLocks(db: Db, projectId: string) {
  const result = await db.query('SELECT * FROM project_locks WHERE project_id = $1', [projectId])
  return result.rows
}
