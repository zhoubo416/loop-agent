import { config } from '../config.js'
import { ApiError } from '../http/errors.js'
import type { MeetingSyncRow, MeetingTranscriptSegment } from '../modules/meeting-sync.js'

interface McpResponse {
  result?: Record<string, unknown>
  error?: { code?: number; message?: string; data?: unknown }
}

export interface TencentMeetingSync {
  meetingCode: string
  meetingId: string | null
  recordFileId: string | null
  meetingTitle: string | null
  startedAt: string | null
  endedAt: string | null
  participants: string[]
  summary: string | null
  todo: string | null
  transcript: string | null
  transcriptSegments: MeetingTranscriptSegment[]
}

interface McpTransport {
  callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    if (isRecord(value.structuredContent)) return value.structuredContent
    if (isRecord(value.result)) return asRecord(value.result)
    const content = value.content
    if (Array.isArray(content)) {
      const text = content.find(
        (item): item is { type: 'text'; text: string } =>
          isRecord(item) && item.type === 'text' && typeof item.text === 'string',
      )?.text
      if (text) {
        try {
          const parsed = JSON.parse(text) as unknown
          if (isRecord(parsed)) return parsed
        } catch {
          return { text }
        }
      }
    }
    return value
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return isRecord(parsed) ? parsed : { text: value }
    } catch {
      return { text: value }
    }
  }
  return {}
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number') return String(candidate)
  }
  return null
}

function firstArray(value: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key]
  }
  return []
}

function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value
    return new Date(milliseconds).toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value)
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    return new Date(milliseconds).toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function findNestedRecord(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    if (isRecord(value[key])) return value[key]
  }
  return value
}

function participantName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!isRecord(value)) return null
  return firstString(value, ['name', 'display_name', 'displayName', 'user_name', 'username', 'nickname'])
}

function parseParticipants(value: unknown): string[] {
  const record = asRecord(value)
  const rows = firstArray(record, ['participants', 'items', 'users', 'data'])
  return [...new Set(rows.map(participantName).filter((name): name is string => Boolean(name)))]
}

function parseSegments(value: unknown): MeetingTranscriptSegment[] {
  const record = asRecord(value)
  const rows = firstArray(record, ['paragraphs', 'segments', 'transcripts', 'items', 'data'])
  const candidates = rows.length || !firstString(record, ['text', 'content', 'transcript', 'sentence'])
    ? rows
    : [record]
  return candidates.flatMap((row) => {
    if (typeof row === 'string') return [{ speaker: null, start_at: null, end_at: null, text: row }]
    if (!isRecord(row)) return []
    const text = firstString(row, ['text', 'content', 'transcript', 'sentence'])
    if (!text) return []
    return [{
      speaker: firstString(row, ['speaker', 'speaker_name', 'speakerName', 'user_name']),
      start_at: toIso(row.start_time ?? row.start_at ?? row.startAt),
      end_at: toIso(row.end_time ?? row.end_at ?? row.endAt),
      text,
    }]
  })
}

function parseMeeting(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  return findNestedRecord(record, ['meeting', 'data'])
}

function parseMinutes(value: unknown): { summary: string | null; todo: string | null } {
  const record = asRecord(value)
  const minute = findNestedRecord(record, ['meeting_minute', 'minutes', 'smart_minutes', 'data'])
  return {
    summary: firstString(minute, ['minute', 'summary', 'content', 'text']),
    todo: firstString(minute, ['todo', 'todos', 'action_items', 'actionItems']),
  }
}

function parseRecordId(value: unknown): string | null {
  const record = asRecord(value)
  const rows = firstArray(record, ['records', 'record_files', 'items', 'data'])
  const candidate = (rows[0] && isRecord(rows[0]) ? rows[0] : record)
  return firstString(candidate, ['record_file_id', 'recordFileId', 'meeting_record_id', 'id'])
}

function parseRecordError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error)
  if (/permission|权限|forbidden|无权|access/i.test(message)) {
    return new ApiError('INTEGRATION_AUTH_FAILED', '没有权限读取这场会议的录制或纪要')
  }
  if (/processing|generat|处理中|生成中|not found|不存在/i.test(message)) {
    return new ApiError('INTEGRATION_UNAVAILABLE', '腾讯会议录制或逐字稿仍在处理中，请稍后重试')
  }
  return new ApiError('INTEGRATION_UNAVAILABLE', `腾讯会议内容暂时不可用:${message}`)
}

function parseMcpBody(body: string, contentType: string): McpResponse {
  if (contentType.includes('text/event-stream')) {
    const dataLines = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
    const data = dataLines.at(-1)
    if (!data) throw new Error('腾讯会议 MCP 没有返回数据')
    return JSON.parse(data) as McpResponse
  }
  return JSON.parse(body) as McpResponse
}

class RemoteMcpTransport implements McpTransport {
  private requestId = 0
  private sessionId: string | null = null
  private initialized = false

  constructor(private readonly token: string) {}

  private async request(
    method: string,
    params: Record<string, unknown>,
    notification = false,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.tencentMeetingTimeoutMs)
    try {
      const response = await fetch(config.tencentMeetingMcpUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'MCP-Protocol-Version': '2025-03-26',
          'X-Tencent-Meeting-Token': this.token,
          'X-Skill-Version': config.tencentMeetingSkillVersion,
          ...(this.sessionId ? { 'MCP-Session-Id': this.sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          ...(notification ? {} : { id: ++this.requestId }),
          method,
          params,
        }),
        signal: controller.signal,
      })
      const body = await response.text()
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}${body ? `:${body.slice(0, 200)}` : ''}`)
      }
      if (notification || !body.trim()) return {}
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) this.sessionId = sessionId
      return parseMcpBody(body, response.headers.get('content-type') ?? '')
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('INTEGRATION_UNAVAILABLE', '腾讯会议 MCP 请求超时，请稍后重试')
      }
      throw new ApiError('INTEGRATION_UNAVAILABLE', '无法连接腾讯会议 MCP 服务')
    } finally {
      clearTimeout(timeout)
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    const response = (await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'loop', version: '0.1.0' },
    })) as McpResponse
    if (response.error) throw new ApiError('INTEGRATION_UNAVAILABLE', response.error.message ?? '腾讯会议 MCP 初始化失败')
    this.initialized = true
    await this.request('notifications/initialized', {}, true)
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    await this.initialize()
    const response = (await this.request('tools/call', { name, arguments: arguments_ })) as McpResponse
    if (response.error) throw new Error(response.error.message ?? `腾讯会议 MCP 工具调用失败:${name}`)
    const result = response.result ?? {}
    if (result.isError) throw new Error(firstString(result, ['message', 'error']) ?? `腾讯会议 MCP 工具调用失败:${name}`)
    return result
  }
}

export async function syncTencentMeeting(
  token: string,
  meetingCode: string,
  transport: McpTransport = new RemoteMcpTransport(token),
): Promise<TencentMeetingSync> {
  if (!/^\d{9}$/.test(meetingCode)) {
    throw new ApiError('VALIDATION_ERROR', '腾讯会议号必须是 9 位数字')
  }

  const meeting = parseMeeting(await transport.callTool('get_meeting_by_code', { meeting_code: meetingCode }))
  const meetingId = firstString(meeting, ['meeting_id', 'meetingId', 'id'])
  const meetingTitle = firstString(meeting, ['topic', 'subject', 'title', 'meeting_title'])
  const startedAt = toIso(meeting.start_time ?? meeting.started_at ?? meeting.startAt)
  const endedAt = toIso(meeting.end_time ?? meeting.ended_at ?? meeting.endAt)

  let participants: string[] = []
  try {
    participants = parseParticipants(
      await transport.callTool('get_meeting_participants', {
        ...(meetingId ? { meeting_id: meetingId } : {}),
        meeting_code: meetingCode,
      }),
    )
  } catch {
    // 参会人权限不足时不阻断纪要同步,页面会展示已获取到的其他内容
  }

  let recordFileId: string | null = null
  try {
    recordFileId = parseRecordId(
      await transport.callTool('get_records_list', {
        ...(meetingId ? { meeting_id: meetingId } : {}),
        meeting_code: meetingCode,
      }),
    )
  } catch (error) {
    throw parseRecordError(error)
  }
  if (!recordFileId) throw new ApiError('INTEGRATION_UNAVAILABLE', '这场会议还没有可读取的云录制')

  let summary: string | null = null
  let todo: string | null = null
  try {
    const minutes = parseMinutes(await transport.callTool('get_smart_minutes', { record_file_id: recordFileId }))
    summary = minutes.summary
    todo = minutes.todo
  } catch (error) {
    throw parseRecordError(error)
  }

  let transcriptSegments: MeetingTranscriptSegment[] = []
  try {
    const paragraphs = await transport.callTool('get_transcripts_paragraphs', { record_file_id: recordFileId })
    transcriptSegments = parseSegments(paragraphs)
    if (!transcriptSegments.length) {
      const paragraphRecord = asRecord(paragraphs)
      const ids = firstArray(paragraphRecord, ['paragraphs', 'items', 'data']).flatMap((item) => {
        if (!isRecord(item)) return []
        return [firstString(item, ['pid', 'paragraph_id', 'id'])].filter((id): id is string => Boolean(id))
      })
      const details = await Promise.all(
        ids.slice(0, 200).map((pid) =>
          transport.callTool('get_transcripts_details', { record_file_id: recordFileId, pid }),
        ),
      )
      transcriptSegments = details.flatMap(parseSegments)
    }
  } catch (error) {
    throw parseRecordError(error)
  }

  return {
    meetingCode,
    meetingId,
    recordFileId,
    meetingTitle,
    startedAt,
    endedAt,
    participants,
    summary,
    todo,
    transcriptSegments,
    transcript: transcriptSegments
      .map((segment) => `${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text}`)
      .join('\n') || null,
  }
}

export function meetingSyncToApi(row: MeetingSyncRow): Record<string, unknown> {
  return {
    id: row.id,
    action_id: row.action_id,
    meeting_code: row.meeting_code,
    meeting_id: row.meeting_id,
    record_file_id: row.record_file_id,
    meeting_title: row.meeting_title,
    started_at: row.started_at,
    ended_at: row.ended_at,
    participants: row.participants,
    summary: row.summary,
    todo: row.todo,
    transcript: row.transcript,
    transcript_segments: row.transcript_segments,
    synced_at: row.synced_at,
  }
}
