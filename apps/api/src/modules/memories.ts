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

function memoryTerms(query: string): string[] {
  const chunks = query.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? []
  const terms = new Set<string>()
  for (const chunk of chunks) {
    if (/^[\u4e00-\u9fff]+$/.test(chunk)) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        terms.add(chunk.slice(index, index + 2))
      }
    } else {
      terms.add(chunk)
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 24)
}

/**
 * 先按当前上下文做轻量关键词召回,再用最近记忆补足上下文。
 * 这不是向量检索,但比固定取最新 N 条更不会漏掉较早的关键事实。
 */
export async function retrieveMemories(
  db: Db,
  projectId: string,
  query: string,
  limit = 10,
): Promise<MemoryRow[]> {
  const terms = memoryTerms(query)
  if (terms.length === 0) return listMemories(db, projectId, { status: 'active', limit })

  const termParams = terms.map((term) => `%${term}%`)
  const conditions = terms.map((_, index) => `content ILIKE $${index + 2}`)
  const relevance = terms
    .map((_, index) => `CASE WHEN content ILIKE $${index + 2} THEN 1 ELSE 0 END`)
    .join(' + ')
  const result = await db.query<MemoryRow>(
    `SELECT * FROM memories
     WHERE project_id = $1 AND status = 'active' AND (${conditions.join(' OR ')})
     ORDER BY (${relevance}) DESC, created_at DESC
     LIMIT $${terms.length + 2}`,
    [projectId, ...termParams, limit],
  )

  if (result.rows.length >= limit) return result.rows
  const recent = await listMemories(db, projectId, { status: 'active', limit })
  const seen = new Set(result.rows.map((row) => row.id))
  return [...result.rows, ...recent.filter((row) => !seen.has(row.id))].slice(0, limit)
}
