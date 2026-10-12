import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'
import { computeNextRun } from '../runtime/schedule-time.js'

export interface ScheduleRow extends Row {
  id: string
  project_id: string
  type: string
  expression: string | null
  payload: Record<string, unknown>
  status: string
  next_run_at: Date | string | null
  last_run_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

export interface CreateScheduleInput {
  projectId: string
  type: string
  expression?: string | null
  payload?: Record<string, unknown>
}

export async function insertSchedule(db: Db, input: CreateScheduleInput): Promise<ScheduleRow> {
  const nextRunAt = computeNextRun(input.type, input.expression ?? null)
  const result = await db.query<ScheduleRow>(
    `INSERT INTO schedules (project_id, type, expression, payload, status, next_run_at)
     VALUES ($1, $2, $3, $4::jsonb, 'active', $5::timestamptz)
     RETURNING *`,
    [
      input.projectId,
      input.type,
      input.expression ?? null,
      JSON.stringify(input.payload ?? {}),
      nextRunAt ? nextRunAt.toISOString() : null,
    ],
  )
  return result.rows[0]!
}

export async function listSchedules(db: Db, projectId: string): Promise<ScheduleRow[]> {
  const result = await db.query<ScheduleRow>(
    'SELECT * FROM schedules WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId],
  )
  return result.rows
}

export async function getSchedule(
  db: Db,
  projectId: string,
  scheduleId: string,
): Promise<ScheduleRow> {
  const result = await db.query<ScheduleRow>(
    'SELECT * FROM schedules WHERE id = $1 AND project_id = $2',
    [scheduleId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('SCHEDULE_NOT_FOUND', 'Schedule 不存在')
  return row
}

export async function setScheduleStatus(
  db: Db,
  projectId: string,
  scheduleId: string,
  status: 'active' | 'paused' | 'completed' | 'cancelled',
): Promise<ScheduleRow> {
  const schedule = await getSchedule(db, projectId, scheduleId)
  const nextRunAt =
    status === 'active' && schedule.next_run_at === null
      ? computeNextRun(schedule.type, schedule.expression)
      : null

  const result = await db.query<ScheduleRow>(
    `UPDATE schedules
     SET status = $2::varchar,
         next_run_at = COALESCE($3::timestamptz, next_run_at),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [scheduleId, status, nextRunAt ? nextRunAt.toISOString() : null],
  )
  return result.rows[0]!
}

export async function listDueSchedules(db: Db, limit = 10): Promise<ScheduleRow[]> {
  const result = await db.query<ScheduleRow>(
    `SELECT * FROM schedules
     WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
     ORDER BY next_run_at
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

export async function advanceSchedule(
  db: Db,
  schedule: ScheduleRow,
  firedAt: Date,
): Promise<void> {
  const nextRunAt = computeNextRun(schedule.type, schedule.expression, firedAt)
  await db.query(
    `UPDATE schedules
     SET last_run_at = $2::timestamptz,
         next_run_at = $3::timestamptz,
         status = CASE WHEN $3::timestamptz IS NULL AND type IN ('once', 'manual', 'event')
                       THEN 'completed' ELSE status END,
         updated_at = now()
     WHERE id = $1`,
    [schedule.id, firedAt.toISOString(), nextRunAt ? nextRunAt.toISOString() : null],
  )
}
