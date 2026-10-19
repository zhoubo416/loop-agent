import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { getDb } from '../../db/client.js'
import { TencentMeetingClient } from '../../integrations/tencent-meeting.js'
import {
  deleteTencentMeetingToken,
  getTencentMeetingIntegration,
  getTencentMeetingToken,
  saveTencentMeetingToken,
} from '../../modules/integrations.js'
import { ApiError } from '../errors.js'
import { resolveUser } from '../auth.js'

const tokenSchema = z.object({ token: z.string().min(1).max(10_000) })
const meetingsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  page_token: z.string().optional(),
})

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_MS = 31 * DAY_MS

/** 把时间格式化成腾讯会议工具默认时区(+08:00)的 ISO 字符串 */
function shanghaiIso(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().replace('Z', '+08:00')
}

function resolveRange(fromValue?: string, toValue?: string): { from: string; to: string } {
  const now = new Date()
  const to = toValue ? new Date(toValue) : now
  const from = fromValue ? new Date(fromValue) : new Date(to.getTime() - 7 * DAY_MS)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError('VALIDATION_ERROR', '时间范围不合法')
  }
  if (from.getTime() >= to.getTime()) {
    throw new ApiError('VALIDATION_ERROR', '开始时间必须早于结束时间')
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new ApiError('VALIDATION_ERROR', '一次最多查询 31 天')
  }
  return { from: shanghaiIso(from), to: shanghaiIso(to) }
}

export function registerIntegrationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/me/integrations/tencent-meeting', async (request) => {
    const user = await resolveUser(request)
    return getTencentMeetingIntegration(getDb(), user.id)
  })

  app.put('/api/v1/me/integrations/tencent-meeting', async (request) => {
    const user = await resolveUser(request)
    const body = tokenSchema.parse(request.body ?? {})
    const token = body.token.trim()

    // 先真实调一次只读工具,确认 Token 可用再落库;近期没有会议时列表可能返回业务错误,
    // 只要不是鉴权失败就说明 Token 已经被接受
    const range = resolveRange()
    const client = new TencentMeetingClient({
      token,
      timeoutMs: Math.min(config.tencentMeetingTimeoutMs, 30_000),
    })
    try {
      await client.listEndedMeetings(range)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'MEETING_CONTENT_NOT_FOUND')) {
        throw error
      }
    }

    return saveTencentMeetingToken(getDb(), user.id, token)
  })

  app.delete('/api/v1/me/integrations/tencent-meeting', async (request) => {
    const user = await resolveUser(request)
    await deleteTencentMeetingToken(getDb(), user.id)
    return { configured: false }
  })

  app.get('/api/v1/me/integrations/tencent-meeting/meetings', async (request) => {
    const user = await resolveUser(request)
    const query = meetingsQuerySchema.parse(request.query ?? {})
    const range = resolveRange(query.from, query.to)
    const token = await getTencentMeetingToken(getDb(), user.id)
    const client = new TencentMeetingClient({ token })
    const result = await client.listEndedMeetings({
      from: range.from,
      to: range.to,
      pageToken: query.page_token ?? null,
    })

    return {
      items: result.items.map((item) => ({
        meeting_id: item.meetingId,
        meeting_code: item.meetingCode,
        sub_meeting_id: item.subMeetingId,
        title: item.title,
        started_at: item.startedAt,
        ended_at: item.endedAt,
      })),
      has_more: result.hasMore,
      next_page_token: result.nextPageToken,
    }
  })
}
