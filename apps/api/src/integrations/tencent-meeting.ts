import { release } from 'node:os'
import { config } from '../config.js'
import { ApiError } from '../http/errors.js'

/**
 * 腾讯会议 MCP 的只读客户端。
 *
 * 官方 Skill 的本地代理也是直接把 JSON-RPC 请求转发到远端,不做 initialize,
 * 这里沿用同样方式;响应可能是 JSON,也可能是 SSE。
 * 业务错误不会设置 JSON-RPC 的 isError,而是包在 data.status_code / data.body 里,
 * 所以拆包时必须自己检查。
 */

export interface TencentMeetingListItem {
  meetingId: string | null
  meetingCode: string | null
  subMeetingId: string | null
  title: string
  startedAt: string | null
  endedAt: string | null
}

export interface TencentMeetingListResult {
  items: TencentMeetingListItem[]
  hasMore: boolean
  nextPageToken: string | null
}

export interface TencentMeetingDetail {
  meetingId: string | null
  meetingCode: string | null
  subMeetingId: string | null
  title: string
  startedAt: string | null
  endedAt: string | null
  /** 会议详情里自带录制列表,录制列表工具查不到时用它兜底 */
  records: TencentMeetingRecord[]
}

export interface TencentMeetingMinutes {
  content: string | null
  /** 会议结论:元宝纪要取 overview,智能纪要取正文里的「会议摘要」 */
  summary: string | null
  todos: string[]
}

export interface TencentMeetingTranscriptSegment {
  speaker: string | null
  startMs: number | null
  endMs: number | null
  text: string
}

export interface TencentMeetingTranscript {
  text: string
  segments: TencentMeetingTranscriptSegment[]
}

interface McpResponse {
  result?: {
    content?: unknown
    structuredContent?: unknown
    isError?: boolean
  }
  error?: { code?: number; message?: string }
}

interface TencentMeetingClientOptions {
  token: string
  fetchImpl?: typeof fetch
  url?: string
  skillVersion?: string
  timeoutMs?: number
}

const MAX_TRANSCRIPT_CHARS = 200_000
const MAX_TRANSCRIPT_SEGMENTS = 500

/** MCP 返回的业务错误,由映射函数转换成对外的 ApiError */
class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function tryJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
  }
  return null
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  return []
}

function firstRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key] as Record<string, unknown>
  }
  return null
}

/** 有些接口把业务对象再包一层 data,这里统一剥掉 */
function businessRecord(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload)
  const data = record.data
  if (isRecord(data) && !('status_code' in data)) return data
  return record
}

function toIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value)
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toMilliseconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

function stringItems(value: unknown): string[] {
  const clean = (text: string) => text.replace(/^[-*•]\s*/, '').trim()
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map(clean)
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      if (typeof item === 'string') return [clean(item)]
      if (!isRecord(item)) return []
      const text = firstString(item, ['content', 'text', 'title', 'point', 'summary'])
      return text ? [clean(text)] : []
    })
    .filter(Boolean)
}

function participantName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!isRecord(value)) return null
  return firstString(value, ['name', 'display_name', 'displayName', 'user_name', 'username', 'nickname'])
}

function parseParticipants(payload: unknown): string[] {
  const record = businessRecord(payload)
  const rows = Array.isArray(payload)
    ? payload
    : firstArray(record, ['participants', 'items', 'users', 'data'])
  return [...new Set(rows.map(participantName).filter((name): name is string => Boolean(name)))]
}

function parseMeetingItem(value: unknown): TencentMeetingListItem | null {
  if (!isRecord(value)) return null
  const meetingId = firstString(value, ['meeting_id', 'meetingId', 'id'])
  const meetingCode = firstString(value, ['meeting_code', 'meetingCode', 'code'])
  if (!meetingId && !meetingCode) return null
  return {
    meetingId,
    meetingCode,
    subMeetingId: firstString(value, ['current_sub_meeting_id', 'sub_meeting_id', 'subMeetingId']),
    title: firstString(value, ['subject', 'topic', 'title', 'meeting_title']) ?? '未命名会议',
    startedAt: toIso(value.start_time ?? value.started_at ?? value.startAt),
    endedAt: toIso(value.end_time ?? value.ended_at ?? value.endAt),
  }
}

export function parseMeetingList(payload: unknown): TencentMeetingListResult {
  const record = businessRecord(payload)
  const rows = Array.isArray(payload)
    ? payload
    : firstArray(record, ['meeting_info_list', 'meetings', 'meeting_list', 'items', 'data'])
  const items = rows
    .map(parseMeetingItem)
    .filter((item): item is TencentMeetingListItem => Boolean(item))
  return {
    items,
    hasMore: Boolean(record.has_more ?? record.hasMore ?? false),
    nextPageToken: firstString(record, ['next_page_token', 'nextPageToken']),
  }
}

export function parseMeetingDetail(payload: unknown): TencentMeetingDetail | null {
  const record = businessRecord(payload)
  const rows = firstArray(record, ['meeting_info_list', 'meeting_list', 'meetings'])
  const meeting = rows.length
    ? asRecord(rows[0])
    : firstRecord(record, ['meeting', 'meeting_info', 'data']) ?? record
  const item = parseMeetingItem(meeting)
  if (!item) return null
  return { ...item, records: parseDetailRecords(meeting) }
}

/** 智能纪要的正文是一整段 Markdown,结论在「会议摘要：」这一行 */
function extractMeetingSummary(text: string | null): string | null {
  if (!text) return null
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^会议摘要\s*[:：]/.test(value))
  if (!line) return null
  return line.replace(/^会议摘要\s*[:：]\s*/, '').trim() || null
}

export function parseMinutes(payload: unknown): TencentMeetingMinutes {
  const record = businessRecord(payload)
  const candidates: Record<string, unknown>[] = []
  const direct = firstRecord(record, [
    'meeting_minute',
    'smart_minutes',
    'minutes',
    'meeting_minutes',
    'minute_list',
    'data',
  ])
  if (direct) candidates.push(direct)
  for (const key of ['minutes', 'meeting_minutes', 'minute_list']) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    for (const row of value) {
      if (isRecord(row)) candidates.push(row)
    }
  }

  const readPoints = (minute: Record<string, unknown>) =>
    stringItems(minute.summary_points ?? minute.summaryPoints ?? minute.points ?? minute.key_points)
  const readTodos = (minute: Record<string, unknown>) =>
    stringItems(minute.todos ?? minute.todo ?? minute.action_items ?? minute.actionItems)
  const minute =
    candidates.find(
      (candidate) =>
        Boolean(firstString(candidate, ['overview', 'summary', 'minute', 'content', 'text'])) ||
        readPoints(candidate).length > 0 ||
        readTodos(candidate).length > 0,
    ) ??
    candidates[0] ??
    record

  const overview = firstString(minute, ['overview', 'summary'])
  const fullText = firstString(minute, ['minute', 'content', 'text'])
  const mainText = overview ?? fullText
  const summary = overview ?? extractMeetingSummary(fullText)
  const points = readPoints(minute)
  const todos = readTodos(minute)

  const parts: string[] = []
  if (mainText) parts.push(mainText)
  if (points.length) parts.push(points.map((point) => `- ${point}`).join('\n'))
  const content = parts.join('\n\n').trim() || null

  return { content, summary, todos }
}

export interface TencentMeetingRecord {
  recordFileId: string
  meetingRecordId: string | null
  mediaStartTime: string | null
  permissionStatus: string | null
}

export function parseRecord(payload: unknown): TencentMeetingRecord | null {
  const record = businessRecord(payload)
  const rows = Array.isArray(payload)
    ? payload
    : firstArray(record, ['record_meetings', 'records', 'record_files', 'items', 'data'])
  const candidates = recordCandidates(rows.length ? rows : [record])
  for (const candidate of candidates) {
    const parsed = parseRecordItem(candidate)
    if (parsed) return parsed
  }
  return null
}

/** 把 record_meetings 的分组行展开成逐条录制文件 */
function recordCandidates(rows: unknown[]): unknown[] {
  const candidates: unknown[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const files = firstArray(row, ['record_files', 'files'])
    if (files.length) candidates.push(...files)
    else candidates.push(row)
  }
  return candidates
}

function parseRecordItem(candidate: unknown): TencentMeetingRecord | null {
  if (!isRecord(candidate)) return null
  const recordFileId = firstString(candidate, ['record_file_id', 'recordFileId', 'file_id', 'id'])
  if (!recordFileId) return null
  return {
    recordFileId,
    meetingRecordId: firstString(candidate, ['meeting_record_id', 'meetingRecordId']),
    mediaStartTime: toIso(
      candidate.media_start_time ?? candidate.mediaStartTime ?? candidate.start_time,
    ),
    permissionStatus: firstString(candidate, ['permission_status', 'permissionStatus']),
  }
}

/** 会议详情里的 records 直接就是录制文件,没有 record_meetings 那层分组 */
function parseDetailRecords(meeting: Record<string, unknown>): TencentMeetingRecord[] {
  return recordCandidates(firstArray(meeting, ['records']))
    .map(parseRecordItem)
    .filter((record): record is TencentMeetingRecord => Boolean(record))
}

function paragraphText(paragraph: Record<string, unknown>): string {
  const direct = firstString(paragraph, ['text', 'content', 'sentence', 'transcript'])
  if (direct) return direct

  const sentences = firstArray(paragraph, ['sentences', 'items'])
  const text = sentences
    .flatMap((sentence) => {
      if (typeof sentence === 'string') return [sentence]
      if (!isRecord(sentence)) return []
      const sentenceText = firstString(sentence, ['text', 'content'])
      if (sentenceText) return [sentenceText]
      const words = firstArray(sentence, ['words'])
      return [words.map((word) => (isRecord(word) ? firstString(word, ['text', 'word']) ?? '' : '')).join('')]
    })
    .join('')
    .trim()
  return text
}

function paragraphSpeaker(paragraph: Record<string, unknown>): string | null {
  const direct = firstString(paragraph, ['speaker_name', 'speakerName', 'user_name', 'nickname'])
  if (direct) return direct

  const info = firstRecord(paragraph, ['speaker_info', 'speakerInfo', 'speaker'])
  if (!info) return null
  return firstString(info, ['username', 'user_name', 'display_name', 'name', 'nickname'])
}

export function parseTranscript(payload: unknown): TencentMeetingTranscript | null {
  const record = businessRecord(payload)
  const minutes = firstRecord(record, ['minutes', 'data']) ?? record
  const rows = firstArray(minutes, ['paragraphs', 'paragraph_list', 'items', 'data'])
  const paragraphs = rows.length ? rows : firstArray(record, ['paragraphs', 'paragraph_list'])

  const segments: TencentMeetingTranscriptSegment[] = []
  let totalChars = 0
  let truncated = false

  for (const row of paragraphs) {
    if (segments.length >= MAX_TRANSCRIPT_SEGMENTS) {
      truncated = true
      break
    }
    if (!isRecord(row)) continue
    const text = paragraphText(row)
    if (!text) continue
    if (totalChars + text.length > MAX_TRANSCRIPT_CHARS) {
      truncated = true
      break
    }
    segments.push({
      speaker: paragraphSpeaker(row),
      startMs: toMilliseconds(row.start_time ?? row.start_ms ?? row.startMs),
      endMs: toMilliseconds(row.end_time ?? row.end_ms ?? row.endMs),
      text,
    })
    totalChars += text.length
  }

  if (!segments.length) return null
  const text = segments
    .map((segment) => `${segment.speaker ? `${segment.speaker}：` : ''}${segment.text}`)
    .join('\n')

  return {
    text: truncated ? `${text}\n…(逐字稿过长,已截断)` : text,
    segments,
  }
}

function clientInfo(): Record<string, string> {
  return {
    os: `${process.platform} ${release()}`,
    agent: 'LOOP',
    model: 'server',
  }
}

function parseMcpBody(body: string, contentType: string): McpResponse {
  if (contentType.includes('text/event-stream')) {
    const data = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean)
      .at(-1)
    if (!data) throw new McpToolError('腾讯会议 MCP 没有返回数据')
    return tryJson(data) as McpResponse
  }
  return tryJson(body) as McpResponse
}

function contentText(result: McpResponse['result']): string | null {
  const content = result?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const item = content.find(
    (entry): entry is { type?: string; text: string } =>
      isRecord(entry) && typeof entry.text === 'string',
  )
  return item?.text ?? null
}

function businessError(body: unknown): string | null {
  const record = asRecord(body)
  const info = firstRecord(record, ['error_info', 'errorInfo'])
  if (info) {
    const message = firstString(info, ['message', 'msg', 'error_description', 'description'])
    if (message) return message
  }
  const error = record.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (isRecord(error)) {
    return (
      firstString(error, ['message', 'msg', 'error_description', 'description', 'code']) ??
      JSON.stringify(error)
    )
  }
  const message = firstString(record, ['message', 'msg', 'error_description', 'error_msg'])
  return message
}

/** 把 MCP 的 data.status_code / data.body 包装拆成业务对象 */
function unwrapPayload(value: unknown, depth = 0): unknown {
  if (depth > 3) return value
  if (typeof value === 'string') {
    const parsed = tryJson(value)
    return parsed === value ? value : unwrapPayload(parsed, depth + 1)
  }
  if (!isRecord(value)) return value

  const data = value.data
  if (isRecord(data) && typeof data.status_code === 'number') {
    const body = unwrapPayload(data.body, depth + 1)
    const message = businessError(body)
    if (data.status_code >= 400 || message) {
      throw new McpToolError(message ?? `腾讯会议 MCP 返回 HTTP ${data.status_code}`)
    }
    return body
  }

  if (typeof value.status_code === 'number') {
    const body = unwrapPayload(value.body, depth + 1)
    const message = businessError(body)
    if (value.status_code >= 400 || message) {
      throw new McpToolError(message ?? `腾讯会议 MCP 返回 HTTP ${value.status_code}`)
    }
    return body
  }

  if (isRecord(data) && Object.keys(value).every((key) => key === 'data' || key === '_meta')) {
    return unwrapPayload(data, depth + 1)
  }

  return value
}

function mapToolMessage(message: string): ApiError {
  if (/token not found|token invalid|invalid token|unauthor|鉴权|登录已失效|未登录/i.test(message)) {
    return new ApiError('INTEGRATION_AUTH_FAILED', '腾讯会议 Token 已失效,请重新绑定')
  }
  if (/permission|权限|forbidden|无权|access denied/i.test(message)) {
    return new ApiError(
      'MEETING_CONTENT_NOT_FOUND',
      '没有权限读取这场会议的录制或纪要,录制权限默认归会议创建者',
    )
  }
  if (/无有效转写|纪要无内容|没有内容|无内容/i.test(message)) {
    return new ApiError(
      'MEETING_CONTENT_NOT_FOUND',
      '这场会议还没有可导入的纪要或逐字稿,请确认主持人已开启云录制或 AI 纪要已生成',
    )
  }
  if (/processing|generat|转码|处理中|生成中|not ready|still/i.test(message)) {
    return new ApiError('INTEGRATION_UNAVAILABLE', '腾讯会议纪要或录制还在生成中,请稍后再试')
  }
  if (/not found|不存在|no data|empty/i.test(message)) {
    return new ApiError('MEETING_CONTENT_NOT_FOUND', '这场会议暂时没有可导入的纪要或录制')
  }
  return new ApiError(
    'INTEGRATION_UNAVAILABLE',
    `腾讯会议内容暂时不可用:${message.slice(0, 300)}`,
  )
}

export class TencentMeetingClient {
  private requestId = 0
  private readonly fetchImpl: typeof fetch
  private readonly url: string
  private readonly skillVersion: string
  private readonly timeoutMs: number
  private readonly token: string

  constructor(options: TencentMeetingClientOptions) {
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
    this.url = options.url ?? config.tencentMeetingMcpUrl
    this.skillVersion = options.skillVersion ?? config.tencentMeetingSkillVersion
    this.timeoutMs = options.timeoutMs ?? config.tencentMeetingTimeoutMs
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'X-Tencent-Meeting-Token': this.token,
          'X-Skill-Version': this.skillVersion,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'tools/call',
          params: {
            name,
            arguments: { ...args, _client_info: clientInfo() },
          },
        }),
        signal: controller.signal,
      })

      const body = await response.text()
      if (!response.ok) {
        if (response.status === 401) {
          throw new ApiError('INTEGRATION_AUTH_FAILED', '腾讯会议 Token 已失效,请重新绑定')
        }
        if (response.status === 403) {
          throw new ApiError(
            'MEETING_CONTENT_NOT_FOUND',
            '没有权限读取这场会议的录制或纪要,录制权限默认归会议创建者',
          )
        }
        throw new ApiError(
          'INTEGRATION_UNAVAILABLE',
          `腾讯会议 MCP 请求失败(HTTP ${response.status})`,
        )
      }

      const payload = parseMcpBody(body, response.headers.get('content-type') ?? '')
      if (payload.error) {
        throw new McpToolError(payload.error.message ?? '腾讯会议 MCP 调用失败')
      }
      const result = payload.result
      if (!result) throw new McpToolError('腾讯会议 MCP 没有返回结果')
      if (result.isError) {
        throw new McpToolError(contentText(result) ?? '腾讯会议 MCP 工具调用失败')
      }

      const text = contentText(result)
      const raw = result.structuredContent ?? (text ? tryJson(text) : result)
      return unwrapPayload(raw)
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof McpToolError) throw mapToolMessage(error.message)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('INTEGRATION_UNAVAILABLE', '腾讯会议 MCP 请求超时,请稍后再试')
      }
      throw new ApiError('INTEGRATION_UNAVAILABLE', '无法连接腾讯会议 MCP 服务')
    } finally {
      clearTimeout(timeout)
    }
  }

  async listEndedMeetings(input: {
    from: string
    to: string
    pageToken?: string | null
  }): Promise<TencentMeetingListResult> {
    const payload = await this.callTool('get_user_ended_meetings', {
      start_time: input.from,
      end_time: input.to,
      page_size: 30,
      is_compact: true,
      timezone: 'Asia/Shanghai',
      ...(input.pageToken ? { page_token: input.pageToken } : {}),
    })
    return parseMeetingList(payload)
  }

  async getMeeting(meetingId: string): Promise<TencentMeetingDetail | null> {
    const payload = await this.callTool('get_meeting', {
      meeting_id: meetingId,
      is_compact: true,
      timezone: 'Asia/Shanghai',
    })
    return parseMeetingDetail(payload)
  }

  async getMeetingByCode(meetingCode: string): Promise<TencentMeetingDetail | null> {
    const payload = await this.callTool('get_meeting_by_code', {
      meeting_code: meetingCode,
      is_compact: true,
      timezone: 'Asia/Shanghai',
    })
    return parseMeetingDetail(payload)
  }

  async getParticipants(input: {
    meetingId: string
    subMeetingId?: string | null
    startedAt?: string | null
    endedAt?: string | null
  }): Promise<string[]> {
    const participants: string[] = []
    let pageToken: string | null = null
    for (let page = 0; page < 3; page += 1) {
      const payload = await this.callTool('get_meeting_participants', {
        meeting_id: input.meetingId,
        page_size: 100,
        is_compact: true,
        timezone: 'Asia/Shanghai',
        ...(input.subMeetingId ? { sub_meeting_id: input.subMeetingId } : {}),
        ...(input.startedAt ? { start_time: input.startedAt } : {}),
        ...(input.endedAt ? { end_time: input.endedAt } : {}),
        ...(pageToken ? { page_token: pageToken } : {}),
      })
      participants.push(...parseParticipants(payload))
      const record = businessRecord(payload)
      if (!record.has_more && !record.hasMore) break
      pageToken = firstString(record, ['next_page_token', 'nextPageToken'])
      if (!pageToken) break
    }
    return [...new Set(participants)]
  }

  async getMinutes(input: { meetingId: string; subMeetingId?: string | null }): Promise<TencentMeetingMinutes> {
    const payload = await this.callTool('get_minutes', {
      meeting_id: input.meetingId,
      overview: true,
      summary_points: true,
      todos: true,
      page_size: 30,
      timezone: 'Asia/Shanghai',
      ...(input.subMeetingId ? { sub_meeting_id: input.subMeetingId } : {}),
    })
    return parseMinutes(payload)
  }

  async getRecord(input: {
    meetingId: string
    meetingCode?: string | null
    startedAt?: string | null
    endedAt?: string | null
  }): Promise<TencentMeetingRecord | null> {
    const payload = await this.callTool('get_records_list', {
      meeting_id: input.meetingId,
      page_size: 30,
      is_compact: true,
      timezone: 'Asia/Shanghai',
      ...(input.startedAt ? { start_time: input.startedAt } : {}),
      ...(input.endedAt ? { end_time: input.endedAt } : {}),
      ...(input.meetingCode ? { meeting_code: input.meetingCode } : {}),
    })
    return parseRecord(payload)
  }

  async getSmartMinutes(recordFileId: string): Promise<TencentMeetingMinutes> {
    const payload = await this.callTool('get_smart_minutes', {
      record_file_id: recordFileId,
      lang: 'default',
      timezone: 'Asia/Shanghai',
    })
    return parseMinutes(payload)
  }

  async getTranscript(input: {
    recordFileId: string
    meetingId?: string | null
  }): Promise<TencentMeetingTranscript | null> {
    const paragraphs = await this.callTool('get_transcripts_paragraphs', {
      record_file_id: input.recordFileId,
      is_compact: true,
      timezone: 'Asia/Shanghai',
      ...(input.meetingId ? { meeting_id: input.meetingId } : {}),
    })
    const record = businessRecord(paragraphs)
    const pidRows = firstArray(record, ['pids', 'paragraphs', 'items', 'data'])
    const firstPid = pidRows
      .map((row) => {
        if (typeof row === 'string') return row
        if (!isRecord(row)) return null
        return firstString(row, ['pid', 'paragraph_id', 'id'])
      })
      .find((pid): pid is string => Boolean(pid))

    const details = await this.callTool('get_transcripts_details', {
      record_file_id: input.recordFileId,
      pid: firstPid ?? '0',
      is_compact: true,
      timezone: 'Asia/Shanghai',
      ...(input.meetingId ? { meeting_id: input.meetingId } : {}),
    })
    return parseTranscript(details)
  }
}
