import type { Db } from '../db/client.js'

export interface RiskFinding {
  id: string
  title: string
  content: string
  severity: 'warning' | 'critical'
}

interface RiskRule {
  staleActionDays: number
  consecutiveFailures: number
  stagnationDays: number
}

const rule: RiskRule = {
  staleActionDays: 7,
  consecutiveFailures: 3,
  stagnationDays: 30,
}

/**
 * Risk Engine:从既有数据里计算确定性的风险,而不是靠模型编。
 * 对应 docs/design/05 第 10 节列出的四类风险。
 */
export async function computeRisks(db: Db, projectId: string): Promise<RiskFinding[]> {
  const risks: RiskFinding[] = []

  // 1. Action 长期没有进展:未结束的 Action 最近 N 天没有新 Execution
  const stale = await db.query<{ id: string; title: string }>(
    `SELECT a.id, a.title
     FROM actions a
     WHERE a.project_id = $1
       AND a.status IN ('pending', 'running')
       AND NOT EXISTS (
         SELECT 1 FROM executions e
         WHERE e.action_id = a.id AND e.started_at > now() - $2::interval
       )
       AND a.created_at < now() - $2::interval`,
    [projectId, `${rule.staleActionDays} days`],
  )
  for (const action of stale.rows) {
    risks.push({
      id: `stale_action:${action.id}`,
      title: '行动长时间没有进展',
      content: `「${action.title}」已经 ${rule.staleActionDays} 天没有新的执行记录,建议确认是否遇到问题。`,
      severity: 'warning',
    })
  }

  // 2. 同一 Action 连续失败达到阈值
  const failed = await db.query<{ id: string; title: string; count: string }>(
    `SELECT a.id, a.title, count(*)::text AS count
     FROM executions e
     JOIN actions a ON a.id = e.action_id
     WHERE a.project_id = $1 AND e.status = 'failed'
     GROUP BY a.id, a.title
     HAVING count(*) >= $2`,
    [projectId, rule.consecutiveFailures],
  )
  for (const action of failed.rows) {
    risks.push({
      id: `consecutive_failures:${action.id}`,
      title: '行动连续失败',
      content: `「${action.title}」已经失败 ${action.count} 次,建议重新评估这条路线的可行性。`,
      severity: 'critical',
    })
  }

  // 3. Project 长时间没有变化:活跃项目最近 N 天没有任何 Observation 或 Event
  const stagnated = await db.query<{ id: string }>(
    `SELECT p.id
     FROM projects p
     WHERE p.id = $1 AND p.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM observations o WHERE o.project_id = p.id AND o.created_at > now() - $2::interval
       )
       AND NOT EXISTS (
         SELECT 1 FROM events ev WHERE ev.project_id = p.id AND ev.created_at > now() - $2::interval
       )`,
    [projectId, `${rule.stagnationDays} days`],
  )
  if (stagnated.rows.length > 0) {
    risks.push({
      id: `stagnation:${projectId}`,
      title: 'Project 长时间没有变化',
      content: `项目已经 ${rule.stagnationDays} 天没有新的观察或事件,可能偏离了目标。`,
      severity: 'warning',
    })
  }

  return risks
}

// 规则参数暴露给测试,保持默认值清晰
export const riskRules = rule
