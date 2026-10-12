import type { Db, Row } from '../db/client.js'

export interface TimelineItem {
  id: string
  type: string
  title: string
  content: string
  status?: string
  created_at: Date | string
}

export interface TimelinePage {
  items: TimelineItem[]
  next_cursor: string | null
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const [createdAt, id] = decoded.split('|')
    if (!createdAt || !id) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * Timeline 不额外建表,由已有事实聚合而成。
 * 对应 docs/design/04-api-design.md 第 31 节。
 */
export async function getTimeline(
  db: Db,
  projectId: string,
  limit = 50,
  cursor?: string,
): Promise<TimelinePage> {
  const params: unknown[] = [projectId]
  let where = ''
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (decoded) {
      params.push(decoded.createdAt, decoded.id)
      where = ' AND (t.created_at, t.id) < ($2::timestamptz, $3::uuid)'
    }
  }
  params.push(limit + 1)

  const result = await db.query<Row>(
    `SELECT * FROM (
       SELECT id, 'observation' AS type, type AS subtype, content AS title, content, NULL AS status, created_at
         FROM observations WHERE project_id = $1
       UNION ALL
       SELECT id, 'event' AS type, type AS subtype, title, content, status, created_at
         FROM events WHERE project_id = $1
       UNION ALL
       SELECT id, 'action' AS type, status AS subtype, title, COALESCE(description, '') AS content,
              status, created_at
         FROM actions WHERE project_id = $1
       UNION ALL
       SELECT r.id, 'recommendation' AS type, r.type AS subtype, r.content AS title,
              COALESCE(r.judgment, r.content) AS content, r.status, r.created_at
         FROM recommendations r WHERE r.project_id = $1
       UNION ALL
       SELECT e.id, 'execution' AS type, e.status AS subtype,
              COALESCE(a.title, 'Execution') AS title,
              COALESCE(e.output->>'summary', '') AS content,
              e.status, e.started_at AS created_at
         FROM executions e JOIN actions a ON a.id = e.action_id
         WHERE a.project_id = $1
     ) t
     WHERE 1 = 1${where}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $${params.length}`,
    params,
  )

  const rows = result.rows
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const items = page.map((row) => ({
    id: row.id as string,
    type: `${row.type}`,
    title: (row.title as string) ?? '',
    content: (row.content as string) ?? '',
    ...(row.status ? { status: row.status as string } : {}),
    created_at: row.created_at as Date | string,
  }))

  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          (last.created_at instanceof Date
            ? last.created_at.toISOString()
            : String(last.created_at)),
          last.id as string,
        )
      : null

  return { items, next_cursor: nextCursor }
}
