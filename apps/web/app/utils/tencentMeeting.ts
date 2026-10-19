export interface TencentMeetingIntegrationStatus {
  configured: boolean
  masked_token: string | null
  updated_at: string | null
}

export interface TencentMeetingListItem {
  meeting_id: string | null
  meeting_code: string | null
  sub_meeting_id: string | null
  title: string
  started_at: string | null
  ended_at: string | null
}

export interface TencentMeetingListResponse {
  items: TencentMeetingListItem[]
  has_more: boolean
  next_page_token: string | null
}

export interface MeetingTranscriptSegment {
  speaker: string | null
  start_ms: number | null
  end_ms: number | null
  text: string
}

export interface MeetingImportSnapshot {
  id: string
  action_id: string
  meeting_id: string | null
  meeting_code: string | null
  sub_meeting_id: string | null
  meeting_title: string | null
  started_at: string | null
  ended_at: string | null
  participants: string[]
  summary: string | null
  minutes: string | null
  todos: string[]
  transcript: string | null
  transcript_segments: MeetingTranscriptSegment[]
  content_source: string
  imported_at: string
}

export function formatMeetingRange(
  startedAt?: string | null,
  endedAt?: string | null,
): string {
  if (!startedAt && !endedAt) return '时间未知'
  if (startedAt && endedAt) return `${formatDateTime(startedAt)} 至 ${formatDateTime(endedAt)}`
  return formatDateTime(startedAt ?? endedAt)
}

export function meetingSourceLabel(source?: string | null): string {
  return source === 'smart_minutes' ? '智能纪要' : '元宝纪要'
}
