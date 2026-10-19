import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { resolveUser } from '../auth.js'
import { ApiError } from '../errors.js'
import { requireProjectAccess } from '../../modules/access.js'
import {
  confirmAction,
  declineAction,
  getActionAnalysis,
  getActionSource,
  getAction,
  insertAction,
  listActions,
  updateAction,
} from '../../modules/actions.js'
import { getExecution, listExecutions } from '../../modules/executions.js'
import { listDocuments } from '../../modules/documents.js'
import { getMeetingImport, meetingImportToApi } from '../../modules/meeting-imports.js'
import {
  getRecommendation,
  listRecommendations,
  resolveRecommendation,
} from '../../modules/recommendations.js'
import { importTencentMeeting } from '../../integrations/tencent-meeting-import.js'
import { cancelAction, completeAction, failAction } from '../../runtime/action-service.js'
import { syncActiveActions } from '../../runtime/active-actions.js'

const createActionSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  executor_type: z.enum(['human', 'agent', 'system']).default('human'),
  assignee_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  due_at: z.string().nullable().optional(),
  event_id: z.string().uuid().nullable().optional(),
  kind: z.enum(['task', 'meeting', 'document']).optional(),
})

const updateActionSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  due_at: z.string().nullable().optional(),
})

const completeSchema = z.object({
  result: z
    .object({
      summary: z.string().optional(),
      output: z.record(z.unknown()).optional(),
    })
    .optional(),
  idempotency_key: z.string().optional(),
})

const failSchema = z.object({ reason: z.string().min(1) })
const cancelSchema = z.object({ reason: z.string().optional() })
const meetingImportSchema = z
  .object({
    meeting_id: z.string().min(1).optional(),
    meeting_code: z.string().min(1).optional(),
    sub_meeting_id: z.string().min(1).optional(),
    started_at: z.string().min(1).optional(),
    ended_at: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.meeting_id || value.meeting_code), {
    message: 'meeting_id 或 meeting_code 至少提供一个',
  })
const acceptSchema = z
  .object({
    create_action: z.boolean().optional(),
    title: z.string().optional(),
    assignee_id: z.string().uuid().nullable().optional(),
  })
  .optional()

export function registerActionRoutes(app: FastifyInstance): void {
  app.get('/api/v1/projects/:projectId/actions', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as {
      status?: string
      executor_type?: string
      priority?: string
      assignee_id?: string
    }
    return {
      items: await listActions(getDb(), projectId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.executor_type ? { executorType: query.executor_type } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.assignee_id ? { assigneeId: query.assignee_id } : {}),
      }),
    }
  })

  app.post('/api/v1/projects/:projectId/actions', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = createActionSchema.parse(request.body ?? {})
    const action = await insertAction(getDb(), {
      projectId,
      title: body.title,
      description: body.description ?? null,
      executorType: body.executor_type,
      assigneeId: body.assignee_id ?? null,
      priority: body.priority,
      dueAt: body.due_at ?? null,
      eventId: body.event_id ?? null,
      kind: body.kind ?? 'task',
    })
    reply.status(201)
    return action
  })

  app.get('/api/v1/projects/:projectId/actions/:actionId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const action = await getAction(getDb(), projectId, actionId)
    return {
      ...action,
      executions: await listExecutions(getDb(), actionId),
      analysis: await getActionAnalysis(getDb(), projectId, actionId),
      source: await getActionSource(getDb(), projectId, action),
      documents: await listDocuments(getDb(), projectId, actionId),
      meeting_import: await getMeetingImport(getDb(), actionId).then((row) =>
        row ? meetingImportToApi(row) : null,
      ),
    }
  })

  /** 从腾讯会议读取一场已结束会议,保存为当前会议 Action 的导入快照 */
  app.post('/api/v1/projects/:projectId/actions/:actionId/meeting-import', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const action = await getAction(getDb(), projectId, actionId)
    if (action.kind !== 'meeting') {
      throw new ApiError('ACTION_KIND_MISMATCH', '只有会议类型的 Action 才能导入腾讯会议内容')
    }
    if (!['pending', 'running'].includes(action.status)) {
      throw new ApiError('ACTION_INVALID_STATE', '这个 Action 已经结束,不能再导入会议内容')
    }

    const body = meetingImportSchema.parse(request.body ?? {})
    const imported = await importTencentMeeting(getDb(), {
      actionId,
      userId: user.id,
      ...(body.meeting_id ? { meetingId: body.meeting_id } : {}),
      ...(body.meeting_code ? { meetingCode: body.meeting_code } : {}),
      ...(body.sub_meeting_id ? { subMeetingId: body.sub_meeting_id } : {}),
      ...(body.started_at ? { startedAt: body.started_at } : {}),
      ...(body.ended_at ? { endedAt: body.ended_at } : {}),
    })
    return { meeting_import: meetingImportToApi(imported) }
  })

  /** Agent 提议的 Action,由用户确认后才进入可执行状态 */
  app.post('/api/v1/projects/:projectId/actions/:actionId/confirm', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await getAction(getDb(), projectId, actionId)
    return getDb().transaction(async (tx) => {
      const confirmed = await confirmAction(tx, actionId)
      await syncActiveActions(tx, projectId, { changedByType: 'user', changedById: user.id })
      return confirmed
    })
  })

  app.post('/api/v1/projects/:projectId/actions/:actionId/decline', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await getAction(getDb(), projectId, actionId)
    return getDb().transaction(async (tx) => {
      const declined = await declineAction(tx, actionId)
      await syncActiveActions(tx, projectId, { changedByType: 'user', changedById: user.id })
      return declined
    })
  })

  app.patch('/api/v1/projects/:projectId/actions/:actionId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await getAction(getDb(), projectId, actionId)
    const body = updateActionSchema.parse(request.body ?? {})
    await updateAction(getDb(), actionId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.assignee_id !== undefined ? { assigneeId: body.assignee_id } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.due_at !== undefined ? { dueAt: body.due_at } : {}),
    })
    return getAction(getDb(), projectId, actionId)
  })

  /** Action 完成:产生 Execution + Result + Observation,并重新唤醒 Agent */
  app.post('/api/v1/projects/:projectId/actions/:actionId/complete', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = completeSchema.parse(request.body ?? {})
    const outcome = await completeAction({
      projectId,
      actionId,
      userId: user.id,
      ...(body.result?.summary ? { summary: body.result.summary } : {}),
      ...(body.result?.output ? { output: body.result.output } : {}),
      ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
    })
    return {
      action_id: outcome.action.id,
      status: outcome.action.status,
      execution_id: outcome.execution.id,
      observation_id: outcome.observation.id,
      agent_run_id: outcome.run?.id ?? null,
    }
  })

  app.post('/api/v1/projects/:projectId/actions/:actionId/fail', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = failSchema.parse(request.body ?? {})
    const outcome = await failAction({ projectId, actionId, userId: user.id, reason: body.reason })
    return {
      action_id: outcome.action.id,
      status: outcome.action.status,
      execution_id: outcome.execution.id,
      observation_id: outcome.observation.id,
      agent_run_id: outcome.run?.id ?? null,
    }
  })

  app.post('/api/v1/projects/:projectId/actions/:actionId/cancel', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = cancelSchema.parse(request.body ?? {})
    const outcome = await cancelAction({
      projectId,
      actionId,
      userId: user.id,
      ...(body.reason ? { reason: body.reason } : {}),
    })
    return {
      action_id: outcome.action.id,
      status: outcome.action.status,
      execution_id: outcome.execution.id,
      observation_id: outcome.observation.id,
      agent_run_id: outcome.run?.id ?? null,
    }
  })

  app.get('/api/v1/projects/:projectId/actions/:actionId/executions', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    await getAction(getDb(), projectId, actionId)
    return { items: await listExecutions(getDb(), actionId) }
  })

  app.get(
    '/api/v1/projects/:projectId/actions/:actionId/executions/:executionId',
    async (request) => {
      const user = await resolveUser(request)
      const { projectId, actionId, executionId } = request.params as {
        projectId: string
        actionId: string
        executionId: string
      }
      await requireProjectAccess(getDb(), projectId, user.id)
      return getExecution(getDb(), actionId, executionId)
    },
  )

  app.get('/api/v1/projects/:projectId/recommendations', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { status?: string }
    return {
      items: await listRecommendations(getDb(), projectId, {
        ...(query.status ? { status: query.status } : {}),
      }),
    }
  })

  app.get('/api/v1/projects/:projectId/recommendations/:recommendationId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, recommendationId } = request.params as {
      projectId: string
      recommendationId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getRecommendation(getDb(), projectId, recommendationId)
  })

  /** 接受 Recommendation:可选地直接生成一个 Action */
  app.post('/api/v1/projects/:projectId/recommendations/:recommendationId/accept', async (request) => {
    const user = await resolveUser(request)
    const { projectId, recommendationId } = request.params as {
      projectId: string
      recommendationId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = acceptSchema.parse(request.body ?? {}) ?? {}
    const recommendation = await getRecommendation(getDb(), projectId, recommendationId)

    let action = null
    if (body.create_action) {
      action = await insertAction(getDb(), {
        projectId,
        title: body.title ?? recommendation.content.slice(0, 200),
        description: recommendation.content,
        executorType: 'human',
        assigneeId: body.assignee_id ?? null,
        priority: recommendation.priority as 'low' | 'medium' | 'high' | 'critical',
        agentRunId: recommendation.agent_run_id,
        recommendationId: recommendation.id,
      })
    }

    const resolved = await resolveRecommendation(
      getDb(),
      projectId,
      recommendationId,
      body.create_action ? 'executed' : 'accepted',
    )
    return { ...resolved, action }
  })

  app.post('/api/v1/projects/:projectId/recommendations/:recommendationId/reject', async (request) => {
    const user = await resolveUser(request)
    const { projectId, recommendationId } = request.params as {
      projectId: string
      recommendationId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = z.object({ reason: z.string().optional() }).parse(request.body ?? {})
    const resolved = await resolveRecommendation(getDb(), projectId, recommendationId, 'rejected')
    return { ...resolved, reason: body.reason ?? null }
  })
}
