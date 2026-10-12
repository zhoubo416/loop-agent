import type { Db } from '../db/client.js'
import { ApiError } from '../http/errors.js'
import type { AgentToolContext } from '../agent/engine.js'
import { insertAction } from '../modules/actions.js'
import { getState } from '../modules/states.js'
import { resolveAgentActionInTx } from '../runtime/action-service.js'

export interface ToolContext {
  db: Db
  projectId: string
  runId: string
  userId: string | null
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

const tools: Tool[] = [
  {
    name: 'get_project_state',
    description: '读取 Project 当前的 State:当前阶段、现状、开放问题、风险和未知项。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      const state = await getState(ctx.db, ctx.projectId)
      return {
        current_stage: state.current_stage,
        current_situation: state.current_situation,
        open_issues: state.open_issues,
        risks: state.risks,
        unknowns: state.unknowns,
        version: state.version,
      }
    },
  },
  {
    name: 'create_action',
    description: '提出一个需要执行的行动。创建后处于待确认状态,需要用户确认才会进入执行。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '行动标题' },
        description: { type: 'string', description: '行动说明' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        executor_type: { type: 'string', enum: ['human', 'agent', 'system'] },
        kind: { type: 'string', enum: ['task', 'meeting', 'document'] },
      },
      required: ['title'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const title = String(args.title ?? '').trim()
      if (!title) throw new ApiError('VALIDATION_ERROR', 'create_action 需要 title')
      const action = await insertAction(ctx.db, {
        projectId: ctx.projectId,
        title,
        description: typeof args.description === 'string' ? args.description : null,
        executorType: (args.executor_type as 'human' | 'agent' | 'system') ?? 'human',
        priority: (args.priority as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
        agentRunId: ctx.runId,
        status: 'proposed',
        kind: (args.kind as 'task' | 'meeting' | 'document') ?? 'task',
      })
      return { id: action.id, status: action.status, title: action.title }
    },
  },
  {
    name: 'complete_action',
    description: '把一个已有 Action 标记为完成(用于 Agent 判断该行动已经通过事件得到结果)。',
    parameters: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: 'Action 的 UUID' },
        summary: { type: 'string', description: '完成结果说明' },
      },
      required: ['action_id'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const actionId = String(args.action_id ?? '').trim()
      if (!actionId) throw new ApiError('VALIDATION_ERROR', 'complete_action 需要 action_id')
      await ctx.db.transaction((tx) =>
        resolveAgentActionInTx(tx, {
          projectId: ctx.projectId,
          actionId,
          status: 'completed',
          summary: typeof args.summary === 'string' ? args.summary : undefined,
          agentRunId: ctx.runId,
        }),
      )
      return { action_id: actionId, status: 'completed' }
    },
  },
]

/**
 * 为一次 Agent Run 构造工具执行上下文。
 * 工具执行发生在 Runtime 里(有数据库访问和 Project 作用域),Engine 只负责协议转换;
 * 对应 docs/design/07 第 22-24 节。
 */
export function createAgentToolContext(
  db: Db,
  scope: { projectId: string; runId: string; userId?: string | null },
): AgentToolContext {
  const ctx: ToolContext = {
    db,
    projectId: scope.projectId,
    runId: scope.runId,
    userId: scope.userId ?? null,
  }

  return {
    descriptors: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    async execute(name, args) {
      const tool = tools.find((item) => item.name === name)
      if (!tool) throw new ApiError('VALIDATION_ERROR', `未知工具:${name}`)

      const inserted = await db.query<{ id: string }>(
        `INSERT INTO tool_calls (agent_run_id, tool_name, input, status)
         VALUES ($1, $2, $3::jsonb, 'running')
         RETURNING id`,
        [scope.runId, name, JSON.stringify(args)],
      )
      const callId = inserted.rows[0]!.id
      try {
        const output = await tool.execute(args, ctx)
        await db.query(
          `UPDATE tool_calls SET status = 'completed', output = $2::jsonb, completed_at = now()
           WHERE id = $1`,
          [callId, JSON.stringify(output ?? {})],
        )
        return output
      } catch (error) {
        await db.query(
          `UPDATE tool_calls SET status = 'failed', error = $2::jsonb, completed_at = now()
           WHERE id = $1`,
          [callId, JSON.stringify({ message: (error as Error).message })],
        )
        throw error
      }
    },
  }
}
