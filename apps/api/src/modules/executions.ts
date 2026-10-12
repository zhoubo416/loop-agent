import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface ExecutionRow extends Row {
  id: string
  action_id: string
  executor_type: string
  executor_id: string | null
  input: Record<string, unknown>
  output: Record<string, unknown>
  status: string
  error: Record<string, unknown> | null
  idempotency_key: string | null
  started_at: Date | string
  completed_at: Date | string | null
}

export interface CreateExecutionInput {
  actionId: string
  executorType: string
  executorId?: string | null
  input?: Record<string, unknown>
  idempotencyKey?: string | null
}

export async function insertExecution(
  db: Db,
  input: CreateExecutionInput,
): Promise<ExecutionRow> {
  if (input.idempotencyKey) {
    const existing = await db.query<ExecutionRow>(
      'SELECT * FROM executions WHERE idempotency_key = $1',
      [input.idempotencyKey],
    )
    if (existing.rows[0]) return existing.rows[0]
  }

  const result = await db.query<ExecutionRow>(
    `INSERT INTO executions (action_id, executor_type, executor_id, input, status, idempotency_key)
     VALUES ($1, $2, $3, $4::jsonb, 'running', $5)
     RETURNING *`,
    [
      input.actionId,
      input.executorType,
      input.executorId ?? null,
      JSON.stringify(input.input ?? {}),
      input.idempotencyKey ?? null,
    ],
  )
  return result.rows[0]!
}

export async function finishExecution(
  db: Db,
  executionId: string,
  status: 'completed' | 'failed' | 'cancelled',
  output: Record<string, unknown>,
  error?: Record<string, unknown> | null,
): Promise<ExecutionRow> {
  const result = await db.query<ExecutionRow>(
    `UPDATE executions
     SET status = $2, output = $3::jsonb, error = $4::jsonb, completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [executionId, status, JSON.stringify(output), error ? JSON.stringify(error) : null],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('EXECUTION_NOT_FOUND', 'Execution 不存在')
  return row
}

export async function getExecution(
  db: Db,
  actionId: string,
  executionId: string,
): Promise<ExecutionRow> {
  const result = await db.query<ExecutionRow>(
    'SELECT * FROM executions WHERE id = $1 AND action_id = $2',
    [executionId, actionId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('EXECUTION_NOT_FOUND', 'Execution 不存在')
  return row
}

export async function listExecutions(db: Db, actionId: string): Promise<ExecutionRow[]> {
  const result = await db.query<ExecutionRow>(
    'SELECT * FROM executions WHERE action_id = $1 ORDER BY started_at DESC',
    [actionId],
  )
  return result.rows
}

export async function listRecentExecutions(
  db: Db,
  projectId: string,
  limit = 10,
): Promise<Array<ExecutionRow & { action_title: string; action_kind: string }>> {
  const result = await db.query<ExecutionRow & { action_title: string; action_kind: string }>(
    `SELECT e.*, a.title AS action_title, a.kind AS action_kind
     FROM executions e
     JOIN actions a ON a.id = e.action_id
     WHERE a.project_id = $1
     ORDER BY e.started_at DESC
     LIMIT $2`,
    [projectId, limit],
  )
  return result.rows
}
