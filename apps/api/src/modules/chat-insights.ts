import type { Db } from '../db/client.js'
import { listRunsBySession, type AgentRunRow } from './runs.js'

export interface ChatRunInsight {
  id: string
  status: string
  created_at: string
  error: { code?: string; message?: string } | null
  judgment: string | null
  state_proposals: Array<{ id: string; proposal: Record<string, unknown>; status: string }>
  events: Array<{ id: string; title: string }>
  actions: Array<{ id: string; title: string; kind: string; priority: string; status: string }>
  recommendations: Array<{
    id: string
    type: string
    content: string
    priority: string
    status: string
  }>
}

interface RunErrorColumn {
  error: { code?: string; message?: string } | null
}

/**
 * Chat 页右侧的思考结果:每个由对话触发的 Agent Run 一条,
 * 附带它产出的 State 提案、新事件、行动和建议。
 *
 * 产出处理过之后仍然返回,并带上各自的状态:这一栏要能回看整轮思考产出了什么、
 * 用户当时怎么处理的,不能在点完「应用」之后就把这条抹掉。前端据此决定给按钮还是给状态标签。
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
    db.query<{ id: string; proposal: Record<string, unknown>; status: string }>(
      `SELECT id, proposal, status FROM state_proposals
       WHERE agent_run_id = $1 ORDER BY created_at`,
      [run.id],
    ),
    db.query<{ id: string; title: string }>(
      `SELECT id, title FROM events WHERE agent_run_id = $1 ORDER BY occurred_at`,
      [run.id],
    ),
    db.query<{ id: string; title: string; kind: string; priority: string; status: string }>(
      `SELECT id, title, kind, priority, status FROM actions
       WHERE agent_run_id = $1 ORDER BY created_at`,
      [run.id],
    ),
    db.query<{ id: string; type: string; content: string; priority: string; status: string }>(
      `SELECT id, type, content, priority, status FROM recommendations
       WHERE agent_run_id = $1 ORDER BY created_at`,
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
    actions: actions.rows,
    recommendations: recommendations.rows,
  }
}