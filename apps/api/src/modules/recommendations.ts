import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface RecommendationRow extends Row {
  id: string
  project_id: string
  agent_run_id: string | null
  judgment: string | null
  type: string
  content: string
  priority: string
  requires_confirmation: boolean
  status: string
  created_at: Date | string
  resolved_at: Date | string | null
}

export interface CreateRecommendationInput {
  projectId: string
  agentRunId?: string | null
  judgment?: string | null
  type: string
  content: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  requiresConfirmation?: boolean
}

export async function insertRecommendation(
  db: Db,
  input: CreateRecommendationInput,
): Promise<RecommendationRow> {
  const result = await db.query<RecommendationRow>(
    `INSERT INTO recommendations
       (project_id, agent_run_id, judgment, type, content, priority, requires_confirmation, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [
      input.projectId,
      input.agentRunId ?? null,
      input.judgment ?? null,
      input.type,
      input.content,
      input.priority ?? 'medium',
      input.requiresConfirmation ?? true,
    ],
  )
  return result.rows[0]!
}

export async function getRecommendation(
  db: Db,
  projectId: string,
  recommendationId: string,
): Promise<RecommendationRow> {
  const result = await db.query<RecommendationRow>(
    'SELECT * FROM recommendations WHERE id = $1 AND project_id = $2',
    [recommendationId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('RECOMMENDATION_NOT_FOUND', 'Recommendation 不存在')
  return row
}

export async function listRecommendations(
  db: Db,
  projectId: string,
  options: { status?: string; limit?: number } = {},
): Promise<RecommendationRow[]> {
  const params: unknown[] = [projectId]
  let where = 'WHERE project_id = $1'
  if (options.status) {
    params.push(options.status)
    where += ` AND status = $${params.length}`
  }
  params.push(options.limit ?? 50)
  const result = await db.query<RecommendationRow>(
    `SELECT * FROM recommendations ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}

export async function resolveRecommendation(
  db: Db,
  projectId: string,
  recommendationId: string,
  status: 'accepted' | 'rejected' | 'expired' | 'executed',
): Promise<RecommendationRow> {
  const current = await getRecommendation(db, projectId, recommendationId)
  if (current.status !== 'pending') {
    throw new ApiError('RECOMMENDATION_ALREADY_RESOLVED', 'Recommendation 已经处理过')
  }
  const result = await db.query<RecommendationRow>(
    `UPDATE recommendations SET status = $2, resolved_at = now() WHERE id = $1 RETURNING *`,
    [recommendationId, status],
  )
  return result.rows[0]!
}
