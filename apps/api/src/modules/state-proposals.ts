import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'
import type { StateProposal } from '../agent/types.js'

export interface StateProposalRow extends Row {
  id: string
  project_id: string
  agent_run_id: string | null
  proposal: StateProposal
  status: 'pending' | 'applied' | 'rejected' | 'expired'
  created_at: Date | string
  resolved_at: Date | string | null
}

export async function insertStateProposal(
  db: Db,
  projectId: string,
  proposal: StateProposal,
  agentRunId: string | null,
): Promise<StateProposalRow> {
  const result = await db.query<StateProposalRow>(
    `INSERT INTO state_proposals (project_id, agent_run_id, proposal, status)
     VALUES ($1, $2, $3::jsonb, 'pending')
     RETURNING *`,
    [projectId, agentRunId, JSON.stringify(proposal)],
  )
  return result.rows[0]!
}

export async function getStateProposal(
  db: Db,
  projectId: string,
  proposalId: string,
): Promise<StateProposalRow> {
  const result = await db.query<StateProposalRow>(
    'SELECT * FROM state_proposals WHERE id = $1 AND project_id = $2',
    [proposalId, projectId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('STATE_NOT_FOUND', 'State Proposal 不存在')
  return row
}

export async function listStateProposals(
  db: Db,
  projectId: string,
  options: { status?: string; limit?: number } = {},
): Promise<StateProposalRow[]> {
  const params: unknown[] = [projectId]
  let where = 'WHERE project_id = $1'
  if (options.status) {
    params.push(options.status)
    where += ` AND status = $${params.length}`
  }
  params.push(options.limit ?? 50)
  const result = await db.query<StateProposalRow>(
    `SELECT * FROM state_proposals ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}

export async function resolveStateProposal(
  db: Db,
  projectId: string,
  proposalId: string,
  status: 'applied' | 'rejected' | 'expired',
): Promise<StateProposalRow> {
  const current = await getStateProposal(db, projectId, proposalId)
  if (current.status !== 'pending') {
    throw new ApiError('STATE_CONFLICT', 'State Proposal 已经处理过')
  }
  const result = await db.query<StateProposalRow>(
    `UPDATE state_proposals SET status = $2, resolved_at = now() WHERE id = $1 RETURNING *`,
    [proposalId, status],
  )
  return result.rows[0]!
}
