import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface NotificationRow extends Row {
  id: string
  project_id: string
  type: string
  severity: string
  title: string
  content: string
  source_type: string | null
  source_id: string | null
  dedup_key: string | null
  status: string
  created_at: Date | string
  read_at: Date | string | null
}

export interface CreateNotificationInput {
  projectId: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  content: string
  sourceType?: string | null
  sourceId?: string | null
  dedupKey?: string | null
}

/** 有 dedup_key 时按 (project_id, dedup_key) 去重,重复的通知不会重复创建 */
export async function ensureNotification(
  db: Db,
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  if (input.dedupKey) {
    const existing = await db.query<NotificationRow>(
      'SELECT * FROM notifications WHERE project_id = $1 AND dedup_key = $2',
      [input.projectId, input.dedupKey],
    )
    if (existing.rows[0]) return null
  }

  const result = await db.query<NotificationRow>(
    `INSERT INTO notifications (project_id, type, severity, title, content, source_type, source_id, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.projectId,
      input.type,
      input.severity,
      input.title,
      input.content,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.dedupKey ?? null,
    ],
  )
  return result.rows[0]!
}

export async function listNotificationsForUser(
  db: Db,
  userId: string,
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<Array<NotificationRow & { project_name: string }>> {
  const params: unknown[] = [userId]
  let where = 'WHERE pu.user_id = $1'
  if (options.status) {
    params.push(options.status)
    where += ` AND n.status = $${params.length}`
  }
  params.push(options.limit ?? 50, options.offset ?? 0)
  const result = await db.query<NotificationRow & { project_name: string }>(
    `SELECT n.*, p.name AS project_name
     FROM notifications n
     JOIN project_users pu ON pu.project_id = n.project_id
     JOIN projects p ON p.id = n.project_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return result.rows
}

export async function unreadCountForUser(db: Db, userId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM notifications n
     JOIN project_users pu ON pu.project_id = n.project_id
     WHERE pu.user_id = $1 AND n.status = 'unread'`,
    [userId],
  )
  return Number.parseInt(result.rows[0]?.count ?? '0', 10)
}

export async function markNotificationRead(
  db: Db,
  notificationId: string,
  userId: string,
): Promise<NotificationRow> {
  const result = await db.query<NotificationRow>(
    `UPDATE notifications n
     SET status = 'read', read_at = now()
     FROM project_users pu
     WHERE n.id = $1 AND pu.project_id = n.project_id AND pu.user_id = $2
     RETURNING n.*`,
    [notificationId, userId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('PROJECT_ACCESS_DENIED', '通知不存在或无权访问')
  return row
}

export async function markAllRead(db: Db, userId: string): Promise<number> {
  const result = await db.query(
    `UPDATE notifications n
     SET status = 'read', read_at = now()
     FROM project_users pu
     WHERE pu.project_id = n.project_id AND pu.user_id = $1 AND n.status = 'unread'`,
    [userId],
  )
  return result.rowCount
}
