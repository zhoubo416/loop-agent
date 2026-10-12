import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { ApiError } from '../errors.js'
import { resolveUser } from '../auth.js'
import { requireProjectAccess } from '../../modules/access.js'
import {
  addMember,
  createProject,
  listMembers,
  listProjects,
  removeMember,
  setProjectStatus,
  updateMemberRole,
  updateProject,
} from '../../modules/projects.js'
import { applyStateProposal, getState, listStateVersions } from '../../modules/states.js'
import {
  addMessage,
  createSession,
  getSession,
  listMessages,
  listSessions,
} from '../../modules/sessions.js'
import { listOpenActions } from '../../modules/actions.js'
import {
  getRecommendation,
  listRecommendations,
  resolveRecommendation,
} from '../../modules/recommendations.js'
import {
  getStateProposal,
  listStateProposals,
  resolveStateProposal,
} from '../../modules/state-proposals.js'
import { getOverview } from '../../modules/overview.js'
import { getTimeline } from '../../modules/timeline.js'
import { submitObservation } from '../../runtime/trigger.js'
import { withIdempotency } from '../../modules/idempotency.js'

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  objective: z.string().min(1),
  description: z.string().optional(),
  success_criteria: z.unknown().optional(),
  constraints: z.unknown().optional(),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  objective: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  success_criteria: z.unknown().optional(),
  constraints: z.unknown().optional(),
})

const chatSchema = z.object({
  content: z.string().min(1),
  session_id: z.string().uuid().optional(),
  idempotency_key: z.string().optional(),
})

const sessionSchema = z.object({
  type: z.enum(['chat', 'meeting', 'schedule', 'event', 'api', 'system']).default('chat'),
})

const memberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
})

const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) })

const completionSchema = z.object({ recommendation_id: z.string().uuid().optional() }).optional()

export function registerProjectRoutes(app: FastifyInstance): void {
  app.post('/api/v1/projects', async (request, reply) => {
    const user = await resolveUser(request)
    const body = createProjectSchema.parse(request.body ?? {})
    const project = await createProject(
      getDb(),
      {
        name: body.name,
        objective: body.objective,
        ...(body.description ? { description: body.description } : {}),
        successCriteria: body.success_criteria,
        constraints: body.constraints,
      },
      user.id,
    )
    reply.status(201)
    return project
  })

  app.get('/api/v1/projects', async (request) => {
    const user = await resolveUser(request)
    const query = request.query as { page?: string; page_size?: string; status?: string }
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size ?? '20', 10) || 20))
    const result = await listProjects(getDb(), user.id, {
      page,
      pageSize,
      ...(query.status ? { status: query.status } : {}),
    })
    return { items: result.items, page, page_size: pageSize, total: result.total }
  })

  app.get('/api/v1/projects/:projectId', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    return requireProjectAccess(getDb(), projectId, user.id)
  })

  app.patch('/api/v1/projects/:projectId', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    const body = updateProjectSchema.parse(request.body ?? {})
    return updateProject(getDb(), projectId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.objective !== undefined ? { objective: body.objective } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.success_criteria !== undefined ? { successCriteria: body.success_criteria } : {}),
      ...(body.constraints !== undefined ? { constraints: body.constraints } : {}),
    })
  })

  app.post('/api/v1/projects/:projectId/pause', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    return setProjectStatus(getDb(), projectId, 'paused')
  })

  app.post('/api/v1/projects/:projectId/resume', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const project = await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    if (project.status === 'completed' || project.status === 'archived') {
      throw new ApiError('PROJECT_COMPLETED', 'Project 已结束,不能恢复')
    }
    return setProjectStatus(getDb(), projectId, 'active')
  })

  app.post('/api/v1/projects/:projectId/archive', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const project = await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    if (project.status === 'archived') return project
    return setProjectStatus(getDb(), projectId, 'archived')
  })

  app.post('/api/v1/projects/:projectId/completion/confirm', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const project = await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    if (project.status === 'completed') return project

    const body = completionSchema.parse(request.body ?? {}) ?? {}
    const db = getDb()

    let recommendation
    if (body.recommendation_id) {
      recommendation = await getRecommendation(db, projectId, body.recommendation_id)
      if (recommendation.type !== 'completion') {
        throw new ApiError('VALIDATION_ERROR', '指定的 Recommendation 不是完成建议')
      }
      if (recommendation.status !== 'pending') {
        throw new ApiError('RECOMMENDATION_ALREADY_RESOLVED', '这条完成建议已经处理过')
      }
    } else {
      const pending = await listRecommendations(db, projectId, { status: 'pending' })
      recommendation = pending.find((item) => item.type === 'completion') ?? null
    }
    if (!recommendation) {
      throw new ApiError('PROJECT_NOT_COMPLETABLE', '还没有 Agent 提出的完成建议,先让 Agent 判断项目是否接近完成')
    }

    // 完成条件:没有已确认未完成的 Action,也没有开放问题
    const [openActions, state] = await Promise.all([listOpenActions(db, projectId), getState(db, projectId)])
    const openIssues = Array.isArray(state.open_issues) ? state.open_issues : []
    if (openActions.length > 0 || openIssues.length > 0) {
      throw new ApiError('PROJECT_NOT_COMPLETABLE', '还有未完成的 Action 或未解决的开放问题', {
        open_actions: openActions.map((action) => action.title),
        open_issues: openIssues,
      })
    }

    await resolveRecommendation(db, projectId, recommendation.id, 'executed')
    return setProjectStatus(db, projectId, 'completed')
  })

  app.get('/api/v1/projects/:projectId/state', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getState(getDb(), projectId)
  })

  app.get('/api/v1/projects/:projectId/state/versions', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return { items: await listStateVersions(getDb(), projectId) }
  })

  app.get('/api/v1/projects/:projectId/state/proposals', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { status?: string }
    return {
      items: await listStateProposals(getDb(), projectId, {
        ...(query.status ? { status: query.status } : {}),
      }),
    }
  })

  /** 确认并应用 Agent 提出的 State 变更 */
  app.post('/api/v1/projects/:projectId/state/proposals/:proposalId/apply', async (request) => {
    const user = await resolveUser(request)
    const { projectId, proposalId } = request.params as { projectId: string; proposalId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const proposal = await getStateProposal(getDb(), projectId, proposalId)

    return getDb().transaction(async (tx) => {
      const state = await getState(tx, projectId)
      const updated = await applyStateProposal(tx, projectId, proposal.proposal, {
        agentRunId: proposal.agent_run_id,
        expectedVersion: state.version,
        changedByType: 'user',
        changedById: user.id,
      })
      await resolveStateProposal(tx, projectId, proposalId, 'applied')
      return { state: updated, proposal_id: proposalId, status: 'applied' }
    })
  })

  app.post('/api/v1/projects/:projectId/state/proposals/:proposalId/reject', async (request) => {
    const user = await resolveUser(request)
    const { projectId, proposalId } = request.params as { projectId: string; proposalId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const resolved = await resolveStateProposal(getDb(), projectId, proposalId, 'rejected')
    return { proposal_id: resolved.id, status: resolved.status }
  })

  app.get('/api/v1/projects/:projectId/overview', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const project = await requireProjectAccess(getDb(), projectId, user.id)
    return getOverview(getDb(), project)
  })

  app.get('/api/v1/projects/:projectId/timeline', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { limit?: string; cursor?: string }
    const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit ?? '50', 10) || 50))
    const page = await getTimeline(getDb(), projectId, limit, query.cursor)
    return { items: page.items, next_cursor: page.next_cursor }
  })

  app.get('/api/v1/projects/:projectId/members', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return { items: await listMembers(getDb(), projectId) }
  })

  app.post('/api/v1/projects/:projectId/members', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    const body = memberSchema.parse(request.body ?? {})
    const member = await addMember(getDb(), projectId, body.user_id, body.role)
    reply.status(201)
    return member
  })

  app.patch('/api/v1/projects/:projectId/members/:userId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, userId } = request.params as { projectId: string; userId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    const body = roleSchema.parse(request.body ?? {})
    await updateMemberRole(getDb(), projectId, userId, body.role)
    return { user_id: userId, role: body.role }
  })

  app.delete('/api/v1/projects/:projectId/members/:userId', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, userId } = request.params as { projectId: string; userId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'admin')
    await removeMember(getDb(), projectId, userId)
    reply.status(204)
    return null
  })

  app.post('/api/v1/projects/:projectId/sessions', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const body = sessionSchema.parse(request.body ?? {})
    const session = await createSession(getDb(), projectId, body.type, user.id)
    reply.status(201)
    return session
  })

  app.get('/api/v1/projects/:projectId/sessions/:sessionId', async (request) => {
    const user = await resolveUser(request)
    const { projectId, sessionId } = request.params as { projectId: string; sessionId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    return getSession(getDb(), projectId, sessionId)
  })

  app.get('/api/v1/projects/:projectId/sessions', async (request) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const query = request.query as { type?: string; limit?: string }
    const limit = Math.min(100, Number.parseInt(query.limit ?? '20', 10) || 20)
    const sessions = await listSessions(getDb(), projectId, limit)
    return {
      items: query.type ? sessions.filter((session) => session.type === query.type) : sessions,
    }
  })

  app.get('/api/v1/projects/:projectId/sessions/:sessionId/messages', async (request) => {
    const user = await resolveUser(request)
    const { projectId, sessionId } = request.params as { projectId: string; sessionId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    await getSession(getDb(), projectId, sessionId)
    return { items: await listMessages(getDb(), sessionId) }
  })

  app.post('/api/v1/projects/:projectId/chat', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    const body = chatSchema.parse(request.body ?? {})
    const idempotencyKey =
      body.idempotency_key ?? (request.headers['idempotency-key'] as string | undefined)

    const result = await withIdempotency(`chat:${projectId}`, idempotencyKey, async () => {
      const db = getDb()
      const session = body.session_id
        ? await getSession(db, projectId, body.session_id)
        : await createSession(db, projectId, 'chat', user.id)

      await addMessage(db, session.id, 'user', body.content)
      const { observation, run } = await submitObservation({
        projectId,
        userId: user.id,
        type: 'user_input',
        content: body.content,
        source: 'chat',
        sessionId: session.id,
      })

      return {
        session_id: session.id,
        observation_id: observation.id,
        agent_run_id: run?.id ?? null,
        status: 'queued' as const,
      }
    })

    reply.status(result.replayed ? 200 : 202)
    return { ...result.value, replayed: result.replayed }
  })
}
