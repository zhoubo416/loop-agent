import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { ApiError } from '../errors.js'
import { resolveUser } from '../auth.js'
import { SseStream } from '../sse.js'
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
import { getAction, listOpenActions } from '../../modules/actions.js'
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
import { getEngine } from '../../agent/engine-factory.js'
import { AgentEngineError } from '../../agent/engine.js'
import { buildConversationInput } from '../../agent/context-builder.js'
import { listChatRunInsights } from '../../modules/chat-insights.js'

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
  /** 从资料页进入的对话:携带资料行动 ID,把文档文本作为上下文 */
  document_id: z.string().uuid().optional(),
})

const sessionSchema = z.object({
  type: z.enum(['chat', 'meeting', 'schedule', 'event', 'api', 'system']).default('chat'),
})

/** 一次对话的完整结果:流式时随 done 事件发出,同时按幂等键缓存,重复提交直接回放 */
interface ChatResult {
  session_id: string
  reply: string
  /** 模型的推理过程,没有或与回复正文相同时为 null;只用于展示,不进入后续上下文 */
  reasoning: string | null
  observation_id: string
  agent_run_id: string | null
}

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

  /** Chat 页右侧的思考结果:对话触发的 Run 及其产出 */
  app.get('/api/v1/projects/:projectId/sessions/:sessionId/runs', async (request) => {
    const user = await resolveUser(request)
    const { projectId, sessionId } = request.params as { projectId: string; sessionId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const session = await getSession(getDb(), projectId, sessionId)
    return { items: await listChatRunInsights(getDb(), session.id) }
  })

  app.post('/api/v1/projects/:projectId/chat', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(getDb(), projectId, user.id)
    const body = chatSchema.parse(request.body ?? {})
    const idempotencyKey =
      body.idempotency_key ?? (request.headers['idempotency-key'] as string | undefined)

    const stream = new SseStream(reply)
    // 已经吐出去的内容:中途失败时靠它判断要不要保留半截回复
    let partial = ''

    try {
      const result = await withIdempotency<ChatResult>(
        `chat:${projectId}`,
        idempotencyKey,
        async () => {
          const db = getDb()
          const session = body.session_id
            ? await getSession(db, projectId, body.session_id)
            : await createSession(db, projectId, 'chat', user.id)

          // 带资料讨论时先校验资料行动确实存在且属于本项目
          if (body.document_id) {
            const action = await getAction(db, projectId, body.document_id)
            if (action.kind !== 'document') {
              throw new ApiError('ACTION_KIND_MISMATCH', '这个行动不是资料,不能作为文档上下文')
            }
          }

          const conversation = await buildConversationInput(
            db,
            projectId,
            session.id,
            body.content,
            body.document_id,
          )
          const engine = getEngine()

          // 对话先行:AI 基于项目背景直接回答,生成一段就发给前端一段
          let replyText: string
          let reasoning = ''
          try {
            replyText = await engine.converse(conversation, {
              onDelta: (text, kind) => {
                // 真正有内容之后才切开 SSE:在这之前失败仍然返回普通 JSON 错误
                if (!stream.isStarted) stream.send('session', { session_id: session.id })
                if (kind === 'reasoning') {
                  reasoning += text
                  stream.send('reasoning', { text })
                } else {
                  partial += text
                  stream.send('delta', { text })
                }
              },
            })
          } catch (error) {
            // 说到一半才断:问题和这半截回复留在这段对话里,这一轮不触发思考,用户直接重发
            if (partial) {
              await addMessage(db, session.id, 'user', body.content, {
                ...(body.document_id ? { document_id: body.document_id } : {}),
              })
              await addMessage(db, session.id, 'assistant', partial, {
                engine: engine.name,
                interrupted: true,
                ...(reasoning ? { reasoning } : {}),
              })
            }
            throw error
          }

          // 上游只给推理、正文为空的兜底情况:两者内容一样,不必再存一份
          const storedReasoning = reasoning && reasoning !== replyText ? reasoning : null

          await addMessage(db, session.id, 'user', body.content, {
            ...(body.document_id ? { document_id: body.document_id } : {}),
          })
          await addMessage(db, session.id, 'assistant', replyText, {
            engine: engine.name,
            ...(storedReasoning ? { reasoning: storedReasoning } : {}),
          })

          // 回复完成后,把这段对话的全部内容作为一条 Observation 交给思考阶段
          const history = await listMessages(db, session.id)
          const conversationText = history
            .filter((row) => row.role === 'user' || row.role === 'assistant')
            // 被中断的半截回复只留给用户看,不进交给思考的问答记录
            .filter((row) => row.metadata?.interrupted !== true)
            .map((row) => `${row.role === 'user' ? '我' : '智能体'}:${row.content}`)
            .join('\n')
          const { observation, run } = await submitObservation({
            projectId,
            userId: user.id,
            type: 'conversation',
            content: conversationText,
            source: 'chat',
            sessionId: session.id,
            metadata: { question: body.content, reply: replyText },
          })

          return {
            session_id: session.id,
            reply: replyText,
            reasoning: storedReasoning,
            observation_id: observation.id,
            agent_run_id: run?.id ?? null,
          }
        },
      )

      // 重复提交(直接回放上次结果)或者 Engine 没走流式:整段回复当作一个增量发出去
      if (!stream.isStarted) {
        stream.send('session', { session_id: result.value.session_id })
        if (result.value.reasoning) stream.send('reasoning', { text: result.value.reasoning })
        stream.send('delta', { text: result.value.reply })
      }
      stream.send('done', {
        session_id: result.value.session_id,
        observation_id: result.value.observation_id,
        agent_run_id: result.value.agent_run_id,
        replayed: result.replayed,
      })
      stream.end()
      return reply
    } catch (error) {
      // 还没吐出任何内容:交给统一错误处理,前端拿到的是普通错误响应
      if (!stream.isStarted) throw error
      stream.send('error', {
        code: error instanceof AgentEngineError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : '对话中断',
      })
      stream.end()
      return reply
    }
  })
}
