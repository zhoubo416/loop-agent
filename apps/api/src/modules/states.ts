import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'
import type { StateProposal } from '../agent/types.js'

export interface AgentStateRow extends Row {
  id: string
  project_id: string
  current_stage: string | null
  current_situation: string | null
  open_issues: unknown[]
  active_actions: unknown[]
  risks: unknown[]
  unknowns: unknown[]
  context: Record<string, unknown>
  version: number
  created_at: Date | string
  updated_at: Date | string
}

export async function getState(db: Db, projectId: string): Promise<AgentStateRow> {
  const result = await db.query<AgentStateRow>('SELECT * FROM agent_states WHERE project_id = $1', [
    projectId,
  ])
  const row = result.rows[0]
  if (!row) throw new ApiError('STATE_NOT_FOUND', 'Project 还没有 State')
  return row
}

export interface ApplyStateOptions {
  agentRunId?: string | null
  expectedVersion?: number
  changedByType?: 'user' | 'agent' | 'system'
  changedById?: string | null
}

/**
 * 应用 State Proposal。使用乐观锁 version 保证并发下不会互相覆盖。
 * 对应 docs/design/03-agent-runtime.md 第 21/22 节。
 */
export async function applyStateProposal(
  db: Db,
  projectId: string,
  proposal: StateProposal,
  options: ApplyStateOptions = {},
): Promise<AgentStateRow> {
  const current = await getState(db, projectId)
  const expectedVersion = options.expectedVersion ?? current.version

  const sets: string[] = []
  const params: unknown[] = [projectId, expectedVersion]
  const push = (column: string, value: unknown, cast = '') => {
    params.push(value)
    sets.push(`${column} = $${params.length}${cast}`)
  }

  if (proposal.currentStage !== undefined) push('current_stage', proposal.currentStage)
  if (proposal.currentSituation !== undefined) push('current_situation', proposal.currentSituation)
  if (proposal.openIssues !== undefined) push('open_issues', JSON.stringify(proposal.openIssues), '::jsonb')
  if (proposal.activeActions !== undefined) {
    push('active_actions', JSON.stringify(proposal.activeActions), '::jsonb')
  }
  if (proposal.risks !== undefined) push('risks', JSON.stringify(proposal.risks), '::jsonb')
  if (proposal.unknowns !== undefined) push('unknowns', JSON.stringify(proposal.unknowns), '::jsonb')
  if (proposal.context !== undefined) push('context', JSON.stringify(proposal.context), '::jsonb')

  if (sets.length === 0) return current

  const updated = await db.query<AgentStateRow>(
    `UPDATE agent_states
     SET ${sets.join(', ')}, version = version + 1, updated_at = now()
     WHERE project_id = $1 AND version = $2
     RETURNING *`,
    params,
  )
  const row = updated.rows[0]
  if (!row) {
    throw new ApiError('STATE_CONFLICT', 'State 已被其他 Agent Run 修改,需要重新读取', {
      expected_version: expectedVersion,
    })
  }

  await db.query(
    `INSERT INTO agent_state_versions
       (project_id, state_id, version, state, changed_by_type, changed_by_id, agent_run_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      projectId,
      row.id,
      row.version,
      JSON.stringify({
        current_stage: row.current_stage,
        current_situation: row.current_situation,
        open_issues: row.open_issues,
        active_actions: row.active_actions,
        risks: row.risks,
        unknowns: row.unknowns,
        context: row.context,
      }),
      options.changedByType ?? 'agent',
      options.changedById ?? null,
      options.agentRunId ?? null,
    ],
  )

  if (proposal.currentStage !== undefined) {
    await db.query('UPDATE projects SET current_stage = $2, updated_at = now() WHERE id = $1', [
      projectId,
      proposal.currentStage,
    ])
  }

  return row
}

export async function listStateVersions(db: Db, projectId: string, limit = 20) {
  const result = await db.query(
    `SELECT id, version, changed_by_type, agent_run_id, created_at
     FROM agent_state_versions
     WHERE project_id = $1
     ORDER BY version DESC
     LIMIT $2`,
    [projectId, limit],
  )
  return result.rows
}
