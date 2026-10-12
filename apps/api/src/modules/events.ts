import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface EventRow extends Row {
  id: string
  project_id: string
  observation_id: string | null
  agent_run_id: string | null
  type: string
  title: string
  content: string
  status: string
  occurred_at: Date | string
  created_at: Date | string
}

export interface CreateEventInput {
  projectId: string
  type: string
  title: string
  content: string
  observationId?: string | null
  agentRunId?: string | null
  occurredAt?: string | null
}

export async function insertEvent(db: Db, input: CreateEventInput): Promise<EventRow> {
  const result = await db.query<EventRow>(
    `INSERT INTO events (project_id, observation_id, agent_run_id, type, title, content, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
     RETURNING *`,
    [
      input.projectId,
      input.observationId ?? null,
      input.agentRunId ?? null,
      input.type,
      input.title,
      input.content,
      input.occurredAt ?? null,
    ],
  )
  return result.rows[0]!
}

export async function getEvent(db: Db, projectId: string, eventId: string): Promise<EventRow> {
  const result = await db.query<EventRow>('SELECT * FROM events WHERE id = $1 AND project_id = $2', [
    eventId,
    projectId,
  ])
  const row = result.rows[0]
  if (!row) throw new ApiError('EVENT_NOT_FOUND', 'Event 不存在')
  return row
}

export interface ListEventsQuery {
  status?: string
  type?: string
  from?: string
  to?: string
  limit?: number
}

export async function listEvents(
  db: Db,
  projectId: string,
  query: ListEventsQuery = {},
): Promise<EventRow[]> {
  const params: unknown[] = [projectId]
  const conditions = ['project_id = $1']
  if (query.status) {
    params.push(query.status)
    conditions.push(`status = $${params.length}`)
  }
  if (query.type) {
    params.push(query.type)
    conditions.push(`type = $${params.length}`)
  }
  if (query.from) {
    params.push(query.from)
    conditions.push(`occurred_at >= $${params.length}::timestamptz`)
  }
  if (query.to) {
    params.push(query.to)
    conditions.push(`occurred_at <= $${params.length}::timestamptz`)
  }
  params.push(query.limit ?? 50)
  const result = await db.query<EventRow>(
    `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}
