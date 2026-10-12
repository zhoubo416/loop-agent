import type { Db } from '../db/client.js'
import { listOpenActions } from '../modules/actions.js'
import { applyStateProposal, getState } from '../modules/states.js'

export interface SyncOptions {
  agentRunId?: string | null
  changedByType?: 'agent' | 'system' | 'user'
  changedById?: string | null
}

/**
 * 让 State 里的 active_actions 摘要和 actions 表里未结束的记录保持一致。
 * Action 的确认、完成、失败、取消都可能改变“当前有哪些行动在进行”,这些路径
 * 都要调用它,不能只在 Agent Run 结束时同步一次。
 */
export async function syncActiveActions(
  db: Db,
  projectId: string,
  options: SyncOptions = {},
): Promise<number> {
  const open = await listOpenActions(db, projectId)
  const titles = open.map((action) => action.title)
  const state = await getState(db, projectId)
  const current = Array.isArray(state.active_actions) ? (state.active_actions as string[]) : []
  if (JSON.stringify([...current].sort()) === JSON.stringify([...titles].sort())) {
    return state.version
  }
  const updated = await applyStateProposal(db, projectId, { activeActions: titles }, {
    agentRunId: options.agentRunId ?? null,
    expectedVersion: state.version,
    changedByType: options.changedByType ?? 'system',
    changedById: options.changedById ?? null,
  })
  return updated.version
}
