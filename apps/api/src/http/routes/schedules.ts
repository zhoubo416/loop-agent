import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { resolveUser } from '../auth.js'
import { requireProjectAccess } from '../../modules/access.js'
import { insertSchedule, listSchedules, setScheduleStatus } from '../../modules/schedules.js'
import { processDueSchedules } from '../../runtime/scheduler.js'

const createScheduleSchema = z.object({
  type: z.enum(['once', 'interval', 'cron', 'event', 'manual']),
  expression: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
  /** true 时立刻用当前时间跑一次,便于验证 Schedule 触发链路 */
  run_now: z.boolean().optional(),
})

export function registerScheduleRoutes(app: FastifyInstance): void {
  app.get('/api/v1/projects/:projectId/schedules', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return { items: await listSchedules(getDb(), projectId) }
  })

  app.post('/api/v1/projects/:projectId/schedules', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = createScheduleSchema.parse(request.body ?? {})
    const schedule = await insertSchedule(getDb(), {
      projectId,
      type: body.type,
      expression: body.expression ?? null,
      payload: body.payload ?? {},
    })

    if (body.run_now) {
      await getDb().query('UPDATE schedules SET next_run_at = now() WHERE id = $1', [schedule.id])
      await processDueSchedules()
    }

    reply.status(201)
    return schedule
  })

  app.post('/api/v1/projects/:projectId/schedules/:scheduleId/pause', async (request) => {
    const user = await resolveUser(request)
    const { projectId, scheduleId } = request.params as { projectId: string; scheduleId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    return setScheduleStatus(getDb(), projectId, scheduleId, 'paused')
  })

  app.post('/api/v1/projects/:projectId/schedules/:scheduleId/resume', async (request) => {
    const user = await resolveUser(request)
    const { projectId, scheduleId } = request.params as { projectId: string; scheduleId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    return setScheduleStatus(getDb(), projectId, scheduleId, 'active')
  })

  app.delete('/api/v1/projects/:projectId/schedules/:scheduleId', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, scheduleId } = request.params as { projectId: string; scheduleId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const schedule = await setScheduleStatus(getDb(), projectId, scheduleId, 'cancelled')
    reply.status(200)
    return schedule
  })
}
