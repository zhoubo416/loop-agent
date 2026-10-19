import type { Db } from '../db/client.js'
import { ApiError } from '../http/errors.js'
import { getTencentMeetingToken } from '../modules/integrations.js'
import {
  saveMeetingImport,
  type MeetingImportRow,
} from '../modules/meeting-imports.js'
import {
  TencentMeetingClient,
  type TencentMeetingDetail,
  type TencentMeetingMinutes,
  type TencentMeetingRecord,
  type TencentMeetingTranscript,
} from './tencent-meeting.js'

export interface ImportTencentMeetingInput {
  actionId: string
  userId: string
  meetingId?: string
  meetingCode?: string
  subMeetingId?: string
  /** 列表里选中的那一场会议的时间,周期会议用它定位到具体实例 */
  startedAt?: string
  endedAt?: string
}

const RECORD_WINDOW_MS = 60 * 60 * 1000

/**
 * 会议详情会带整条系列会议的录制,按选中实例的时间挑出对应的一条。
 * 时间对不上时不猜,避免把另一场会议的录制导进来。
 */
function pickDetailRecord(
  records: TencentMeetingRecord[],
  startedAt: string | null,
  endedAt: string | null,
): TencentMeetingRecord | null {
  if (!records.length) return null
  const visible = records.filter(
    (record) => !record.permissionStatus || record.permissionStatus === 'can_view',
  )
  const candidates = visible.length ? visible : records
  if (!startedAt || !endedAt) return candidates[0] ?? null

  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return candidates[0] ?? null

  return (
    candidates.find((record) => {
      if (!record.mediaStartTime) return false
      const mediaTime = new Date(record.mediaStartTime).getTime()
      return (
        !Number.isNaN(mediaTime) &&
        mediaTime >= start - RECORD_WINDOW_MS &&
        mediaTime <= end + RECORD_WINDOW_MS
      )
    }) ?? null
  )
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INTEGRATION_AUTH_FAILED'
}

async function lookupMeeting(
  client: TencentMeetingClient,
  input: ImportTencentMeetingInput,
): Promise<TencentMeetingDetail> {
  try {
    const meeting = input.meetingId
      ? await client.getMeeting(input.meetingId)
      : await client.getMeetingByCode(input.meetingCode ?? '')
    if (!meeting) {
      throw new ApiError('MEETING_NOT_FOUND', '没有找到这场会议,请确认它属于当前绑定的腾讯会议账号')
    }
    return meeting
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MEETING_CONTENT_NOT_FOUND') {
      throw new ApiError('MEETING_NOT_FOUND', '没有找到这场会议,请确认它属于当前绑定的腾讯会议账号')
    }
    throw error
  }
}

/** 元宝纪要的待办是独立字段,补进正文,让纪要正文保持完整 */
function appendTodoSection(content: string | null, todos: string[]): string {
  const base = (content ?? '').trim()
  const missing = todos.filter((todo) => !base.includes(todo))
  if (!missing.length) return base
  const section = `待办事项\n${missing.map((todo) => `- ${todo}`).join('\n')}`
  return base ? `${base}\n\n${section}` : section
}

/**
 * 纪要正文里「发言人：」一行列了实际发言的人。
 * 参会人明细接口只对会议创建者开放,拿不到时用它兜底。
 */
function speakersFromMinutes(content: string | null): string[] {
  if (!content) return []
  const line = content
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^发言人\s*[:：]/.test(value))
  if (!line) return []
  const names = line
    .replace(/^发言人\s*[:：]\s*/, '')
    .replace(/等\s*\d+\s*人$/, '')
    .split(/[,，、;；]/)
    .map((name) => name.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

/** 逐字稿每个段落都带发言人,是参会人的最后兜底 */
function speakersFromTranscript(segments: Array<{ speaker: string | null }>): string[] {
  const names = segments.map((segment) => segment.speaker).filter((name): name is string => Boolean(name))
  return [...new Set(names)]
}

/**
 * 读取一场腾讯会议并保存为 Action 的导入快照。
 *
 * 纪要和逐字稿里任何一项可用就允许导入;逐字稿只写快照,不会进入
 * Agent Observation。权限不足、录制还在处理这类问题只影响对应内容,
 * 只有 Token 失效才中止整次导入。
 */
export async function importTencentMeeting(
  db: Db,
  input: ImportTencentMeetingInput,
): Promise<MeetingImportRow> {
  const token = await getTencentMeetingToken(db, input.userId)
  const client = new TencentMeetingClient({ token })

  const meeting = await lookupMeeting(client, input)
  const meetingId = meeting.meetingId ?? input.meetingId
  if (!meetingId) {
    throw new ApiError('MEETING_NOT_FOUND', '无法确定这场会议的 ID,请重新选择')
  }
  const subMeetingId = input.subMeetingId ?? meeting.subMeetingId ?? null
  const startedAt = input.startedAt ?? meeting.startedAt
  const endedAt = input.endedAt ?? meeting.endedAt

  let participants: string[] = []
  try {
    participants = await client.getParticipants({
      meetingId,
      subMeetingId,
      startedAt,
      endedAt,
    })
  } catch (error) {
    if (isAuthError(error)) throw error
  }

  let minutes: TencentMeetingMinutes = { content: null, summary: null, todos: [] }
  let contentSource: 'minutes' | 'smart_minutes' = 'minutes'
  let lastUnavailable: ApiError | null = null
  const remember = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'INTEGRATION_UNAVAILABLE') {
      lastUnavailable = error
    }
  }
  try {
    minutes = await client.getMinutes({ meetingId, subMeetingId })
  } catch (error) {
    if (isAuthError(error)) throw error
    remember(error)
  }

  let record: TencentMeetingRecord | null = null
  try {
    record = await client.getRecord({
      meetingId,
      meetingCode: meeting.meetingCode ?? input.meetingCode ?? null,
      startedAt,
      endedAt,
    })
  } catch (error) {
    if (isAuthError(error)) throw error
    remember(error)
  }
  if (!record) record = pickDetailRecord(meeting.records, startedAt, endedAt)

  if (!minutes.content && !minutes.todos.length && record) {
    try {
      const smart = await client.getSmartMinutes(record.recordFileId)
      if (smart.content || smart.todos.length) {
        minutes = smart
        contentSource = 'smart_minutes'
      }
    } catch (error) {
      if (isAuthError(error)) throw error
      remember(error)
    }
  }
  // 智能纪要正文本来就带待办,只有元宝纪要需要把待办补进正文
  if (contentSource === 'minutes' && minutes.todos.length) {
    minutes = { ...minutes, content: appendTodoSection(minutes.content, minutes.todos) }
  }

  let transcript: TencentMeetingTranscript | null = null
  if (record) {
    try {
      transcript = await client.getTranscript({
        recordFileId: record.recordFileId,
        meetingId,
      })
    } catch (error) {
      if (isAuthError(error)) throw error
      remember(error)
    }
  }

  // 参会人明细只对会议创建者开放,拿不到时从纪要的发言人一行、再从逐字稿兜底
  if (!participants.length) {
    participants = speakersFromMinutes(minutes.content)
  }
  if (!participants.length && transcript) {
    participants = speakersFromTranscript(transcript.segments)
  }

  if (!minutes.content && !minutes.todos.length && !transcript) {
    if (lastUnavailable) throw lastUnavailable
    throw new ApiError(
      'MEETING_CONTENT_NOT_FOUND',
      '这场会议还没有可导入的纪要或逐字稿,请确认主持人已开启云录制或 AI 纪要已生成',
    )
  }

  return saveMeetingImport(db, {
    actionId: input.actionId,
    meetingId,
    meetingCode: meeting.meetingCode ?? input.meetingCode ?? null,
    subMeetingId,
    meetingTitle: meeting.title,
    startedAt,
    endedAt,
    participants,
    summary: minutes.summary,
    minutes: minutes.content,
    todos: minutes.todos,
    transcript: transcript?.text ?? null,
    transcriptSegments:
      transcript?.segments.map((segment) => ({
        speaker: segment.speaker,
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        text: segment.text,
      })) ?? [],
    contentSource,
    importedBy: input.userId,
  })
}
