import { getDb, type Db } from '../db/client.js'
import { getAction, setActionStatus, type ActionRow } from '../modules/actions.js'
import { insertExecution, finishExecution, type ExecutionRow } from '../modules/executions.js'
import { insertObservation, type ObservationRow } from '../modules/observations.js'
import { insertRun, type AgentRunRow } from '../modules/runs.js'
import { ApiError } from '../http/errors.js'
import { syncActiveActions } from './active-actions.js'

function asLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).map((item) => item.trim()).filter(Boolean)
}

/**
 * 把一次执行的结构化结果整理成信息密集的文字,
 * 让 Observation 带着“有效信息”回到 Agent,而不是只有一句状态。
 */
function summarizeResult(kind: string, summary: string, output: Record<string, unknown>): string {
  const parts = [summary.trim()]
  const notes = typeof output.notes === 'string' ? output.notes.trim() : ''
  const content = typeof output.content === 'string' ? output.content.trim() : ''

  if (kind === 'meeting') {
    const participants = asLines(output.participants)
    const decisions = asLines(output.decisions)
    const actionItems = asLines(output.action_items ?? output.actionItems)
    if (participants.length) parts.push(`参与人:${participants.join('、')}`)
    if (notes) parts.push(`纪要:${notes}`)
    if (decisions.length) parts.push(`决定:${decisions.join(';')}`)
    if (actionItems.length) parts.push(`后续行动:${actionItems.join(';')}`)
  } else if (kind === 'document') {
    const keyPoints = asLines(output.key_points ?? output.keyPoints)
    if (keyPoints.length) parts.push(`要点:${keyPoints.join(';')}`)
    if (content) parts.push(`内容:${content}`)
  } else {
    const results = asLines(output.results)
    const blockers = asLines(output.blockers)
    if (results.length) parts.push(`结果:${results.join(';')}`)
    if (blockers.length) parts.push(`阻塞:${blockers.join(';')}`)
    if (notes) parts.push(`说明:${notes}`)
  }
  return parts.filter(Boolean).join('\n')
}

export interface ActionOutcome {
  action: ActionRow
  execution: ExecutionRow
  observation: ObservationRow
  run?: AgentRunRow
}

export interface ResolveAgentActionInput {
  projectId: string
  actionId: string
  status: 'completed' | 'failed' | 'cancelled'
  summary?: string
  agentRunId: string
}

/**
 * Agent 在输出里把一个新事件与已有 Action 挂钩时调用:
 * 记录一次 agent 类型的 Execution、更新 Action 状态、写 Observation,但不触发新的 Run
 * (当前这次 Run 本身就是在处理这个事件)。对应 docs/design/03 第 28 节。
 */
export async function resolveAgentActionInTx(
  tx: Db,
  input: ResolveAgentActionInput,
): Promise<void> {
  const action = await getAction(tx, input.projectId, input.actionId)
  if (['completed', 'failed', 'cancelled'].includes(action.status)) return

  const execution = await insertExecution(tx, {
    actionId: action.id,
    executorType: 'agent',
    executorId: null,
    input: { action_id: action.id, action_title: action.title, agent_run_id: input.agentRunId },
  })

  if (input.status === 'completed') {
    await finishExecution(tx, execution.id, 'completed', {
      summary: input.summary ?? `${action.title} 已完成`,
    })
    await setActionStatus(tx, action.id, 'completed')
  } else if (input.status === 'failed') {
    await finishExecution(tx, execution.id, 'failed', {}, {
      message: input.summary ?? 'Agent 判定执行失败',
    })
    await setActionStatus(tx, action.id, 'failed')
  } else {
    await finishExecution(tx, execution.id, 'cancelled', {}, {
      message: input.summary ?? 'Agent 判定取消',
    })
    await setActionStatus(tx, action.id, 'cancelled')
  }

  await insertObservation(tx, {
    projectId: input.projectId,
    type: 'action_result',
    content: input.summary ?? `${action.title} 已${input.status === 'completed' ? '完成' : input.status === 'failed' ? '失败' : '取消'}`,
    source: 'agent',
    userId: null,
    metadata: {
      action_id: action.id,
      execution_id: execution.id,
      status: input.status,
      agent_run_id: input.agentRunId,
    },
  })
  await syncActiveActions(tx, input.projectId, {
    agentRunId: input.agentRunId,
    changedByType: 'agent',
  })
}

export interface CompleteActionInput {
  projectId: string
  actionId: string
  userId: string
  summary?: string
  output?: Record<string, unknown>
  idempotencyKey?: string
  triggerAgent?: boolean
}

/**
 * Action 完成 = Execution + Result + Observation + 新的 Agent Run。
 *
 * 这四件事必须在同一个事务里发生,否则 Agent Loop 会断在中间。
 * 对应 docs/design/03-agent-runtime.md 第 14/27 节。
 */
export async function completeAction(
  input: CompleteActionInput,
  db: Db = getDb(),
): Promise<ActionOutcome> {
  return db.transaction(async (tx) => {
    const action = await getAction(tx, input.projectId, input.actionId)
    if (action.status === 'completed') {
      throw new ApiError('ACTION_ALREADY_COMPLETED', 'Action 已经完成')
    }
    if (action.status === 'cancelled') {
      throw new ApiError('ACTION_INVALID_STATE', 'Action 已取消,不能再完成')
    }

    if (action.status === 'pending') {
      await setActionStatus(tx, action.id, 'running')
    }

    const execution = await insertExecution(tx, {
      actionId: action.id,
      executorType: action.executor_type,
      executorId: input.userId,
      input: { action_id: action.id, action_title: action.title },
      idempotencyKey: input.idempotencyKey ?? null,
    })

    const output = input.output ?? {}
    const summary = input.summary ?? `${action.title} 已完成`
    const observationContent = summarizeResult(action.kind ?? 'task', summary, output)
    await finishExecution(tx, execution.id, 'completed', { summary, kind: action.kind ?? 'task', ...output })

    const completed = await setActionStatus(tx, action.id, 'completed')
    await syncActiveActions(tx, input.projectId, {
      changedByType: 'user',
      changedById: input.userId,
    })

    const observation = await insertObservation(tx, {
      projectId: input.projectId,
      type: 'action_result',
      content: observationContent,
      source: 'action',
      userId: input.userId,
      metadata: {
        action_id: action.id,
        execution_id: execution.id,
        status: 'completed',
        kind: action.kind ?? 'task',
      },
    })

    let run: AgentRunRow | undefined
    if (input.triggerAgent !== false) {
      run = await insertRun(tx, {
        projectId: input.projectId,
        triggerType: 'observation',
        triggerId: observation.id,
        inputContext: { observation_type: 'action_result', action_id: action.id },
      })
    }

    return { action: completed, execution, observation, ...(run ? { run } : {}) }
  })
}

export interface FailActionInput {
  projectId: string
  actionId: string
  userId: string
  reason: string
  triggerAgent?: boolean
}

export async function failAction(input: FailActionInput, db: Db = getDb()): Promise<ActionOutcome> {
  return db.transaction(async (tx) => {
    const action = await getAction(tx, input.projectId, input.actionId)
    if (action.status === 'completed' || action.status === 'cancelled') {
      throw new ApiError('ACTION_INVALID_STATE', 'Action 已经结束,无法标记失败')
    }

    const execution = await insertExecution(tx, {
      actionId: action.id,
      executorType: action.executor_type,
      executorId: input.userId,
      input: { action_id: action.id, action_title: action.title },
    })
    await finishExecution(tx, execution.id, 'failed', {}, { message: input.reason })
    const failed = await setActionStatus(tx, action.id, 'failed')
    await syncActiveActions(tx, input.projectId, {
      changedByType: 'user',
      changedById: input.userId,
    })

    const observation = await insertObservation(tx, {
      projectId: input.projectId,
      type: 'action_result',
      content: `${action.title} 执行失败:${input.reason}`,
      source: 'action',
      userId: input.userId,
      metadata: { action_id: action.id, execution_id: execution.id, status: 'failed' },
    })

    let run: AgentRunRow | undefined
    if (input.triggerAgent !== false) {
      run = await insertRun(tx, {
        projectId: input.projectId,
        triggerType: 'observation',
        triggerId: observation.id,
        inputContext: { observation_type: 'action_result', action_id: action.id, status: 'failed' },
      })
    }

    return { action: failed, execution, observation, ...(run ? { run } : {}) }
  })
}

export interface CancelActionInput {
  projectId: string
  actionId: string
  userId: string
  reason?: string
  triggerAgent?: boolean
}

export async function cancelAction(
  input: CancelActionInput,
  db: Db = getDb(),
): Promise<ActionOutcome> {
  return db.transaction(async (tx) => {
    const action = await getAction(tx, input.projectId, input.actionId)
    if (action.status === 'completed') {
      throw new ApiError('ACTION_INVALID_STATE', 'Action 已完成,无法取消')
    }

    const execution = await insertExecution(tx, {
      actionId: action.id,
      executorType: 'human',
      executorId: input.userId,
      input: { action_id: action.id, reason: input.reason ?? null },
    })
    await finishExecution(tx, execution.id, 'cancelled', {}, { message: input.reason ?? '用户取消' })
    const cancelled = await setActionStatus(tx, action.id, 'cancelled')
    await syncActiveActions(tx, input.projectId, {
      changedByType: 'user',
      changedById: input.userId,
    })

    const reason = input.reason ? `,原因:${input.reason}` : ''
    const observation = await insertObservation(tx, {
      projectId: input.projectId,
      type: 'action_result',
      content: `${action.title} 已取消${reason}`,
      source: 'action',
      userId: input.userId,
      metadata: { action_id: action.id, execution_id: execution.id, status: 'cancelled' },
    })

    let run: AgentRunRow | undefined
    if (input.triggerAgent !== false) {
      run = await insertRun(tx, {
        projectId: input.projectId,
        triggerType: 'observation',
        triggerId: observation.id,
        inputContext: { observation_type: 'action_result', action_id: action.id, status: 'cancelled' },
      })
    }

    return { action: cancelled, execution, observation, ...(run ? { run } : {}) }
  })
}
