import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { resolveUser } from '../auth.js'
import { requireProjectAccess } from '../../modules/access.js'
import { getObservation, listObservations } from '../../modules/observations.js'
import { cancelRun, getRun, listRuns } from '../../modules/runs.js'
import { insertEvent, getEvent, listEvents } from '../../modules/events.js'
import { withIdempotency } from '../../modules/idempotency.js'
import { createManualRun, submitObservation } from '../../runtime/trigger.js'
import { executeAgentRun } from '../../runtime/agent-runner.js'
import { triggerEventSchedules } from '../../runtime/scheduler.js'

const observationSchema = z.object({
  type: z.enum([
    'user_input',
    'meeting',
    'document',
    'action_result',
    'external_event',
    'schedule',
    'api',
    'system',
  ]),
  content: z.string().min(1),
  source: z.string().max(100).optional(),
  session_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const manualRunSchema = z.object({
  trigger_type: z.enum(['user', 'observation', 'schedule', 'event', 'api', 'system', 'manual']).default('manual'),
  instruction: z.string().optional(),
  wait: z.boolean().optional(),
})

const eventSchema = z.object({
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  occurred_at: z.string().optional(),
  trigger_agent: z.boolean().optional(),
})

export function registerObservationRoutes(app: FastifyInstance): void {
  /**
   * Observation 是 Agent 感知现实的统一入口。
   * Chat、Action Result、外部系统、定时任务最终都走这里。
   */
  app.post('/api/v1/projects/:projectId/observations', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const body = observationSchema.parse(request.body ?? {})
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined

    const result = await withIdempotency(`observation:${projectId}`, idempotencyKey, async () => {
      const { observation, run } = await submitObservation({
        projectId,
        userId: user.id,
        type: body.type,
        content: body.content,
        ...(body.source ? { source: body.source } : {}),
        sessionId: body.session_id ?? null,
        metadata: body.metadata ?? {},
      })
      return {
        id: observation.id,
        project_id: observation.project_id,
        type: observation.type,
        content: observation.content,
        created_at: observation.created_at,
        agent_run: run ? { id: run.id, status: 'queued' } : null,
      }
    })

    reply.status(result.replayed ? 200 : 202)
    return { ...result.value, replayed: result.replayed }
  })

  app.get('/api/v1/projects/:projectId/observations', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { type?: string; limit?: string }
    return {
      items: await listObservations(getDb(), projectId, {
        ...(query.type ? { type: query.type } : {}),
        limit: Math.min(200, Number.parseInt(query.limit ?? '50', 10) || 50),
      }),
    }
  })

  app.get('/api/v1/projects/:projectId/observations/:observationId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, observationId } = request.params as {
      projectId: string
      observationId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getObservation(getDb(), projectId, observationId)
  })

  app.get('/api/v1/projects/:projectId/runs', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as {
      status?: string
      trigger_type?: string
      page?: string
      page_size?: string
    }
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size ?? '20', 10) || 20))
    const result = await listRuns(getDb(), projectId, {
      page,
      pageSize,
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger_type ? { triggerType: query.trigger_type } : {}),
    })
    return { items: result.items, page, page_size: pageSize, total: result.total }
  })

  app.get('/api/v1/projects/:projectId/runs/:runId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, runId } = request.params as { projectId: string; runId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getRun(getDb(), projectId, runId)
  })

  /** 手动触发一次 Agent Run。wait=true 时同步执行,方便调试和端到端测试。 */
  app.post('/api/v1/projects/:projectId/runs', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const body = manualRunSchema.parse(request.body ?? {})
    const run = await createManualRun(projectId, user.id, {
      ...(body.instruction ? { instruction: body.instruction } : {}),
    })

    if (body.wait) {
      const outcome = await executeAgentRun(run.id)
      const finished = await getRun(getDb(), projectId, run.id)
      return { ...finished, outcome: outcome.status, detail: outcome.detail ?? null }
    }

    reply.status(202)
    return { id: run.id, status: 'queued' }
  })

  app.post('/api/v1/projects/:projectId/runs/:runId/cancel', async (request) => {
    const user = await resolveUser(request)
    const { projectId, runId } = request.params as { projectId: string; runId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    return cancelRun(getDb(), projectId, runId)
  })

  app.get('/api/v1/projects/:projectId/events', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { status?: string; type?: string; from?: string; to?: string }
    return {
      items: await listEvents(getDb(), projectId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      }),
    }
  })

  app.get('/api/v1/projects/:projectId/events/:eventId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, eventId } = request.params as { projectId: string; eventId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getEvent(getDb(), projectId, eventId)
  })

  app.post('/api/v1/projects/:projectId/events', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = eventSchema.parse(request.body ?? {})

    const event = await insertEvent(getDb(), {
      projectId,
      type: body.type,
      title: body.title,
      content: body.content,
      occurredAt: body.occurred_at ?? null,
    })

    // event 型 Schedule:项目里出现了匹配类型的事件就触发 Agent
    await triggerEventSchedules(getDb(), projectId, body.type)

    let run = null
    if (body.trigger_agent) {
      const { observation, run: createdRun } = await submitObservation({
        projectId,
        userId: user.id,
        type: 'external_event',
        content: `${body.title}:${body.content}`,
        source: 'event_api',
        metadata: { event_id: event.id },
      })
      run = { id: createdRun?.id ?? null, observation_id: observation.id }
    }

    reply.status(201)
    return { ...event, agent_run: run }
  })
}
