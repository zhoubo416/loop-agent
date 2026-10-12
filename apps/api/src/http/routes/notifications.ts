import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/client.js'
import { resolveUser } from '../auth.js'
import {
  listNotificationsForUser,
  markAllRead,
  markNotificationRead,
  unreadCountForUser,
} from '../../modules/notifications.js'

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notifications', async (request) => {
    const user = await resolveUser(request)
    const query = request.query as { status?: string; limit?: string; offset?: string }
    const limit = Math.min(100, Number.parseInt(query.limit ?? '50', 10) || 50)
    const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0)
    return {
      items: await listNotificationsForUser(getDb(), user.id, {
        ...(query.status ? { status: query.status } : {}),
        limit,
        offset,
      }),
      unread_count: await unreadCountForUser(getDb(), user.id),
    }
  })

  app.get('/api/v1/notifications/unread-count', async (request) => {
    const user = await resolveUser(request)
    return { count: await unreadCountForUser(getDb(), user.id) }
  })

  app.post('/api/v1/notifications/:notificationId/read', async (request) => {
    const user = await resolveUser(request)
    const { notificationId } = request.params as { notificationId: string }
    return markNotificationRead(getDb(), notificationId, user.id)
  })

  app.post('/api/v1/notifications/read-all', async (request) => {
    const user = await resolveUser(request)
    return { updated: await markAllRead(getDb(), user.id) }
  })
}
