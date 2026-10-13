import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

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
  // seq 保证同一会话内消息的稳定次序;user 消息的 seq 由 Runtime 在同事务里顺延
  const next = await db.query<{ seq: number }>(
    `SELECT coalesce(max(seq), 0) + 1 AS seq FROM session_messages WHERE session_id = $1`,
    [sessionId],
  )
  const seq = next.rows[0]?.seq ?? 1
  const result = await db.query<SessionMessageRow>(
    `INSERT INTO session_messages (session_id, role, content, metadata, seq)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [sessionId, role, content, JSON.stringify(metadata), seq],
  )
  return result.rows[0]!
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
