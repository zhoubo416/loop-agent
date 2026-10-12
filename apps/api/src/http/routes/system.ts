import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/client.js'
import { getEngine } from '../../agent/engine-factory.js'
import { resolveUser } from '../auth.js'
import { ensureDevUser } from '../../db/seed.js'
import { config } from '../../config.js'
import { ApiError } from '../errors.js'

export function registerSystemRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    const db = getDb()
    const engine = getEngine()
    const health = await engine.healthCheck()
    return {
      status: 'ok',
      database: db.describe(),
      agent_engine: { name: engine.name, ...health },
    }
  })

  app.get('/api/v1/me', async (request) => {
    return resolveUser(request)
  })

  // 开发便利接口:前端需要身份才能访问业务接口时,用它拿到开发用户
  app.post('/api/v1/dev-login', async (request, reply) => {
    if (!config.allowDevLogin) {
      throw new ApiError('UNAUTHORIZED', '生产环境不提供开发登录')
    }
    const user = await ensureDevUser()
    reply.status(200)
    return user
  })

  // 成员选择清单:只返回与当前用户共同参与过 Project 的用户,不暴露全量用户
  app.get('/api/v1/users', async (request) => {
    const current = await resolveUser(request)
    const db = getDb()
    const result = await db.query<{ id: string; name: string; email: string | null }>(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       WHERE u.id = $1
          OR u.id IN (
            SELECT pu.user_id
            FROM project_users pu
            WHERE pu.project_id IN (
              SELECT project_id FROM project_users WHERE user_id = $1
            )
          )
       ORDER BY u.name`,
      [current.id],
    )
    return { items: result.rows }
  })
}
