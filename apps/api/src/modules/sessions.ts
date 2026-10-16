import { ApiError } from '../http/errors.js'
import { isUniqueViolation, type Db, type Row } from '../db/client.js'

export interface SessionRow extends Row {
  id: string
  project_id: string
  user_id: string | null
  type: string
  status: string
  started_at: Date | string
  ended_at: Date | string | null
  created_at: Date | string
}

export interface SessionMessageRow extends Row {
  id: string
  session_id: string
  role: string
  content: string
  metadata: Record<string, unknown>
  seq: number
  created_at: Date | string
}

export async function createSession(
  db: Db,
  projectId: string,
  type: string,
  userId: string | null,
): Promise<SessionRow> {
  const result = await db.query<SessionRow>(
    `INSERT INTO sessions (project_id, user_id, type, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING *`,
    [projectId, userId, type],
  )
  return result.rows[0]!
}

export async function getSession(db: Db, projectId: string, sessionId: string): Promise<SessionRow> {
  const result = await db.query<SessionRow>(
    'SELECT * FROM sessions WHERE id = $1 AND project_id = $2',
    [sessionId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('SESSION_NOT_FOUND', 'Session 不存在')
  return row
}

export interface SessionListItem extends SessionRow {
  /** 首条 user 消息内容,前端用作会话标题预览 */
  preview: string | null
  message_count: number
}

export async function listSessions(
  db: Db,
  projectId: string,
  limit = 20,
): Promise<SessionListItem[]> {
  const result = await db.query<SessionListItem>(
    `SELECT s.*,
            (SELECT content FROM session_messages m
              WHERE m.session_id = s.id AND m.role = 'user'
              ORDER BY m.seq LIMIT 1) AS preview,
            (SELECT count(*) FROM session_messages m WHERE m.session_id = s.id) AS message_count
     FROM sessions s WHERE s.project_id = $1
     ORDER BY s.created_at DESC LIMIT $2`,
    [projectId, limit],
  )
  return result.rows
}

export async function addMessage(
  db: Db,
  sessionId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<SessionMessageRow> {
  // seq 是同一会话内的稳定次序。在一条语句里算出来再插入,不做"先查后插":
  // 两次查询之间被别的写入穿插,两条消息会算出同一个 seq。
  const maxAttempts = 3
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await db.query<SessionMessageRow>(
        `INSERT INTO session_messages (session_id, role, content, metadata, seq)
         SELECT $1, $2, $3, $4::jsonb, coalesce(max(seq), 0) + 1
         FROM session_messages WHERE session_id = $1
         RETURNING *`,
        [sessionId, role, content, JSON.stringify(metadata)],
      )
      return result.rows[0]!
    } catch (error) {
      // 真撞上并发时会被 (session_id, seq) 唯一约束挡住,重算一次 seq 再试
      if (attempt + 1 >= maxAttempts || !isUniqueViolation(error)) throw error
    }
  }
}

export async function listMessages(
  db: Db,
  sessionId: string,
  limit = 100,
): Promise<SessionMessageRow[]> {
  const result = await db.query<SessionMessageRow>(
    `SELECT * FROM session_messages WHERE session_id = $1
     ORDER BY seq DESC LIMIT $2`,
    [sessionId, limit],
  )
  return result.rows.reverse()
}
