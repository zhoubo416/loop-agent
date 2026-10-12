import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { hasTencentMeetingToken, saveTencentMeetingToken } from '../../modules/integrations.js'
import { resolveUser } from '../auth.js'

const tencentMeetingSchema = z.object({ token: z.string().min(1).max(10_000) })

export function registerIntegrationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/me/integrations/tencent-meeting', async (request) => {
    const user = await resolveUser(request)
    return { configured: await hasTencentMeetingToken(getDb(), user.id) }
  })

  app.put('/api/v1/me/integrations/tencent-meeting', async (request) => {
    const user = await resolveUser(request)
    const body = tencentMeetingSchema.parse(request.body ?? {})
    await saveTencentMeetingToken(getDb(), user.id, body.token)
    return { configured: true }
  })
}
