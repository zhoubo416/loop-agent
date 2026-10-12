import type { Db } from '../db/client.js'
import type { AgentOutput } from '../agent/types.js'
import { insertAction, listOpenActions, listProposedActions } from '../modules/actions.js'
import { insertEvent } from '../modules/events.js'
import { insertMemory } from '../modules/memories.js'
import { insertRecommendation } from '../modules/recommendations.js'
import { applyStateProposal, getState } from '../modules/states.js'
import type { AgentRunRow } from '../modules/runs.js'
import { insertStateProposal } from '../modules/state-proposals.js'
import type { StateProposal } from '../agent/types.js'
import { syncActiveActions } from './active-actions.js'
import { resolveAgentActionInTx } from './action-service.js'
import { triggerEventSchedules } from './scheduler.js'

export interface ProcessResult {
  judgment?: string
  eventIds: string[]
  actionIds: string[]
  resolvedActionIds: string[]
  recommendationIds: string[]
  memoryIds: string[]
  stateVersion?: number
  stateProposalIds: string[]
  skippedActions: string[]
}

/**
 * 把 Agent 的 State Proposal 拆成两部分:
 * - 自动生效:currentSituation、context(Level 1,整理现状)
 * - 需要确认:currentStage、openIssues、risks、unknowns(Level 2,改变阶段或结构)
 */
function splitStateProposal(proposal: StateProposal): {
  auto: StateProposal | undefined
  pending: StateProposal | undefined
} {
  const auto: StateProposal = {}
  const pending: StateProposal = {}
  if (proposal.currentSituation !== undefined) auto.currentSituation = proposal.currentSituation
  if (proposal.context !== undefined) auto.context = proposal.context
  if (proposal.currentStage !== undefined) pending.currentStage = proposal.currentStage
  if (proposal.openIssues !== undefined) pending.openIssues = proposal.openIssues
  if (proposal.risks !== undefined) pending.risks = proposal.risks
  if (proposal.unknowns !== undefined) pending.unknowns = proposal.unknowns
  return {
    auto: Object.keys(auto).length > 0 ? auto : undefined,
    pending: Object.keys(pending).length > 0 ? pending : undefined,
  }
}

/**
 * 把 Agent Output 变成数据库里的变化。
 *
 * 这里是 LLM 与数据库之间唯一的写入点:Output 经过校验之后,由 Runtime 在事务里
 * 落地 State / Event / Action / Recommendation / Memory。
 * 对应 docs/design/03-agent-runtime.md 第 20 节。
 */
export async function processAgentOutput(
  db: Db,
  run: AgentRunRow,
  output: AgentOutput,
): Promise<ProcessResult> {
  const observationId = run.trigger_type === 'observation' ? run.trigger_id : null

  return db.transaction(async (tx) => {
    const result: ProcessResult = {
      eventIds: [],
      actionIds: [],
      resolvedActionIds: [],
      recommendationIds: [],
      memoryIds: [],
      stateProposalIds: [],
      skippedActions: [],
    }
    if (output.judgment) result.judgment = output.judgment

    for (const event of output.events ?? []) {
      const created = await insertEvent(tx, {
        projectId: run.project_id,
        observationId,
        agentRunId: run.id,
        type: event.type,
        title: event.title,
        content: event.content,
        occurredAt: event.occurredAt ?? null,
      })
      result.eventIds.push(created.id)
    }

    for (const eventType of new Set((output.events ?? []).map((event) => event.type))) {
      await triggerEventSchedules(tx, run.project_id, eventType)
    }

    const [openActions, proposedActions] = await Promise.all([
      listOpenActions(tx, run.project_id),
      listProposedActions(tx, run.project_id),
    ])
    const openTitles = new Set([...openActions, ...proposedActions].map((action) => action.title))

    for (const action of output.actions ?? []) {
      // 引用已有 Action:把本次识别出的事件与进行中的 Action 关联起来
      if (action.id && action.status) {
        await resolveAgentActionInTx(tx, {
          projectId: run.project_id,
          actionId: action.id,
          status: action.status,
          summary: action.description ?? undefined,
          agentRunId: run.id,
        })
        result.resolvedActionIds.push(action.id)
        continue
      }

      if (!action.title) {
        result.skippedActions.push('(缺少标题)')
        continue
      }
      if (openTitles.has(action.title)) {
        result.skippedActions.push(action.title)
        continue
      }
      const created = await insertAction(tx, {
        projectId: run.project_id,
        title: action.title,
        description: action.description ?? null,
        executorType: action.executorType ?? 'human',
        assigneeId: action.assigneeId ?? null,
        priority: action.priority ?? 'medium',
        dueAt: action.dueAt ?? null,
        eventId: result.eventIds[0] ?? null,
        agentRunId: run.id,
        status: 'proposed',
        kind: action.kind ?? 'task',
      })
      result.actionIds.push(created.id)
      openTitles.add(action.title)
    }

    for (const recommendation of output.recommendations ?? []) {
      const created = await insertRecommendation(tx, {
        projectId: run.project_id,
        agentRunId: run.id,
        judgment: output.judgment ?? null,
        type: recommendation.type,
        content: recommendation.content,
        priority: recommendation.priority ?? 'medium',
        requiresConfirmation: recommendation.requiresConfirmation ?? true,
      })
      result.recommendationIds.push(created.id)
    }

    if (output.stateProposal) {
      const { auto, pending } = splitStateProposal(output.stateProposal)
      if (auto) {
        const state = await getState(tx, run.project_id)
        const updated = await applyStateProposal(tx, run.project_id, auto, {
          agentRunId: run.id,
          expectedVersion: state.version,
          changedByType: 'agent',
        })
        result.stateVersion = updated.version
      }
      if (pending) {
        const created = await insertStateProposal(tx, run.project_id, pending, run.id)
        result.stateProposalIds.push(created.id)
      }
    }

    for (const memory of output.memories ?? []) {
      const created = await insertMemory(tx, {
        projectId: run.project_id,
        agentRunId: run.id,
        type: memory.type,
        content: memory.content,
        confidence: memory.confidence ?? null,
        sourceType: 'agent_run',
        sourceId: run.id,
      })
      result.memoryIds.push(created.id)
    }

    // State 里的 active_actions 是当前行动的摘要,由 Runtime 保持同步
    const syncedVersion = await syncActiveActions(tx, run.project_id, {
      agentRunId: run.id,
      changedByType: 'system',
    })
    if (result.stateVersion === undefined) result.stateVersion = syncedVersion

    return result
  })
}
