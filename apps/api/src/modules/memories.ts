import type { Db, Row } from '../db/client.js'

export interface MemoryRow extends Row {
  id: string
  project_id: string
  agent_run_id: string | null
  type: string
  content: string
  source_type: string | null
  source_id: string | null
  confidence: string | number | null
  status: string
  created_at: Date | string
  updated_at: Date | string
}

export interface CreateMemoryInput {
  projectId: string
  agentRunId?: string | null
  type: string
  content: string
  sourceType?: string | null
  sourceId?: string | null
  confidence?: number | null
}

export async function insertMemory(db: Db, input: CreateMemoryInput): Promise<MemoryRow> {
  const result = await db.query<MemoryRow>(
    `INSERT INTO memories (project_id, agent_run_id, type, content, source_type, source_id, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.projectId,
      input.agentRunId ?? null,
      input.type,
      input.content,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.confidence ?? null,
    ],
  )
  return result.rows[0]!
}

export async function listMemories(
  db: Db,
  projectId: string,
  options: { status?: string; limit?: number } = {},
): Promise<MemoryRow[]> {
  const params: unknown[] = [projectId]
  let where = 'WHERE project_id = $1'
  if (options.status) {
    params.push(options.status)
    where += ` AND status = $${params.length}`
  }
  params.push(options.limit ?? 50)
  const result = await db.query<MemoryRow>(
    `SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}
