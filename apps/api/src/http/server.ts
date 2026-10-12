import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { ZodError } from 'zod'
import { ApiError } from './errors.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerObservationRoutes } from './routes/observations.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerScheduleRoutes } from './routes/schedules.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerIntegrationRoutes } from './routes/integrations.js'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true })

  void app.register(cors, {
    origin: true,
    allowedHeaders: ['content-type', 'x-user-id', 'idempotency-key', 'authorization'],
    exposedHeaders: ['idempotency-key'],
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details ?? {} },
      })
      return
    }
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数不合法',
          details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      })
      return
    }
    if (error.statusCode && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: { code: 'VALIDATION_ERROR', message: error.message, details: {} },
      })
      return
    }
    request.log.error(error)
    console.error('[api] 未处理的错误', error)
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务内部错误', details: {} },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: `没有这个接口:${request.method} ${request.url}`,
        details: {},
      },
    })
  })

  registerSystemRoutes(app)
  registerAuthRoutes(app)
  registerIntegrationRoutes(app)
  registerNotificationRoutes(app)
  registerProjectRoutes(app)
  registerObservationRoutes(app)
  registerActionRoutes(app)
  registerScheduleRoutes(app)

  return app
}
