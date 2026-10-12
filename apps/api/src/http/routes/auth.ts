import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { ApiError } from '../errors.js'
import { resolveUser } from '../auth.js'
import { loginUser, registerUser, revokeToken } from '../../modules/auth.js'

const registerSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(8),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

function bearerToken(request: { headers: Record<string, unknown> }): string | null {
  const auth = request.headers.authorization
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null
  return auth.slice('Bearer '.length)
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body ?? {})
    const user = await registerUser(getDb(), body)
    reply.status(201)
    return { user: { id: user.id, name: user.name, email: user.email }, token: user.token }
  })

  app.post('/api/v1/auth/login', async (request) => {
    const body = loginSchema.parse(request.body ?? {})
    const user = await loginUser(getDb(), body)
    return { user: { id: user.id, name: user.name, email: user.email }, token: user.token }
  })

  app.post('/api/v1/auth/logout', async (request) => {
    const token = bearerToken(request)
    if (token) await revokeToken(getDb(), token)
    return { ok: true }
  })

  app.get('/api/v1/auth/me', async (request) => {
    const token = bearerToken(request)
    if (!token) throw new ApiError('UNAUTHORIZED', '未登录')
    return resolveUser(request)
  })
}
