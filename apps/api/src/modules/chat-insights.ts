import type { Db } from '../db/client.js'
import { listRunsBySession, type AgentRunRow } from './runs.js'

export interface ChatRunInsight {
  id: string
  status: string
  created_at: string
  error: { code?: string; message?: string } | null
  judgment: string | null
  state_proposals: Array<{ id: string; proposal: Record<string, unknown> }>
  events: Array<{ id: string; title: string }>
  proposed_actions: Array<{ id: string; title: string; kind: string; priority: string }>
  recommendations: Array<{ id: string; type: string; content: string; priority: string }>
}

interface RunErrorColumn {
  error: { code?: string; message?: string } | null
}

/**
 * Chat 页右侧的思考结果:每个由对话触发的 Agent Run 一条,
 * 附带它产出的待确认 State 提案、新事件、行动提议和建议。
 */
export async function listChatRunInsights(
  db: Db,
  sessionId: string,
  limit = 8,
): Promise<ChatRunInsight[]> {
  const runs = await listRunsBySession(db, sessionId, limit)
  return Promise.all(runs.map((run) => toInsight(db, run)))
}

async function toInsight(db: Db, run: AgentRunRow): Promise<ChatRunInsight> {
  const output = (run.output ?? {}) as { judgment?: string }
  const errorColumn = run as unknown as RunErrorColumn

  const [proposals, events, actions, recommendations] = await Promise.all([
    db.query<{ id: string; proposal: Record<string, unknown> }>(
      `SELECT id, proposal FROM state_proposals
       WHERE agent_run_id = $1 AND status = 'pending' ORDER BY created_at`,
      [run.id],
    ),
    db.query<{ id: string; title: string }>(
      `SELECT id, title FROM events WHERE agent_run_id = $1 ORDER BY occurred_at`,
      [run.id],
    ),
    db.query<{ id: string; title: string; kind: string; priority: string }>(
      `SELECT id, title, kind, priority FROM actions
       WHERE agent_run_id = $1 AND status = 'proposed' ORDER BY created_at`,
      [run.id],
    ),
    db.query<{ id: string; type: string; content: string; priority: string }>(
      `SELECT id, type, content, priority FROM recommendations
       WHERE agent_run_id = $1 AND status = 'pending' ORDER BY created_at`,
      [run.id],
    ),
  ])

  return {
    id: run.id,
    status: run.status,
    created_at: run.created_at as string,
    error: errorColumn.error ?? null,
    judgment: output.judgment ?? null,
    state_proposals: proposals.rows,
    events: events.rows,
    proposed_actions: actions.rows,
    recommendations: recommendations.rows,
  }
}