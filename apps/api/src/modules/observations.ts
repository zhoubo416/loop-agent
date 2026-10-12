import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface ObservationRow extends Row {
  id: string
  project_id: string
  session_id: string | null
  user_id: string | null
  type: string
  content: string
  source: string | null
  metadata: Record<string, unknown>
  created_at: Date | string
}

export interface CreateObservationInput {
  projectId: string
  type: string
  content: string
  source?: string
  userId?: string | null
  sessionId?: string | null
  metadata?: Record<string, unknown>
}

export async function insertObservation(
  db: Db,
  input: CreateObservationInput,
): Promise<ObservationRow> {
  const result = await db.query<ObservationRow>(
    `INSERT INTO observations (project_id, session_id, user_id, type, content, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      input.projectId,
      input.sessionId ?? null,
      input.userId ?? null,
      input.type,
      input.content,
      input.source ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
  return result.rows[0]!
}

export async function getObservation(
  db: Db,
  projectId: string,
  observationId: string,
): Promise<ObservationRow> {
  const result = await db.query<ObservationRow>(
    'SELECT * FROM observations WHERE id = $1 AND project_id = $2',
    [observationId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('OBSERVATION_NOT_FOUND', 'Observation 不存在')
  return row
}

export async function listObservations(
  db: Db,
  projectId: string,
  options: { type?: string; limit?: number } = {},
): Promise<ObservationRow[]> {
  const params: unknown[] = [projectId]
  let where = 'WHERE project_id = $1'
  if (options.type) {
    params.push(options.type)
    where += ` AND type = $${params.length}`
  }
  params.push(options.limit ?? 50)
  const result = await db.query<ObservationRow>(
    `SELECT * FROM observations ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}
