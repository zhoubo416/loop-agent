import type { Db } from '../db/client.js'
import { ensureNotification } from '../modules/notifications.js'
import { getRecommendation } from '../modules/recommendations.js'
import { computeRisks } from './risk-engine.js'
import type { ProcessResult } from './output-processor.js'

function severityFor(priority: string): 'info' | 'warning' | 'critical' {
  if (priority === 'critical') return 'critical'
  if (priority === 'high') return 'warning'
  return 'info'
}

/**
 * Agent Run 结束后生成通知。
 * 通知围绕 Agent 的判断(新建议、新风险),而不是“有东西更新了”;
 * 用 dedup_key 去重,同一条判断不会反复打扰用户。
 */
export async function generateNotifications(
  db: Db,
  projectId: string,
  result: ProcessResult,
): Promise<void> {
  for (const recommendationId of result.recommendationIds) {
    const recommendation = await getRecommendation(db, projectId, recommendationId)
    const needsAttention =
      recommendation.requires_confirmation ||
      recommendation.priority === 'high' ||
      recommendation.priority === 'critical'
    if (!needsAttention) continue

    const isCompletion = recommendation.type === 'completion'
    await ensureNotification(db, {
      projectId,
      type: isCompletion ? 'completion' : 'recommendation',
      severity: severityFor(recommendation.priority),
      title: isCompletion ? 'Agent 建议完成 Project' : 'Agent 有一个建议',
      content: recommendation.content,
      sourceType: 'recommendation',
      sourceId: recommendation.id,
      dedupKey: `recommendation:${recommendation.id}`,
    })
  }

  const risks = await computeRisks(db, projectId)
  for (const risk of risks) {
    await ensureNotification(db, {
      projectId,
      type: 'risk',
      severity: risk.severity,
      title: risk.title,
      content: risk.content,
      dedupKey: `risk:${risk.id}`,
    })
  }
}
