import type { Db, Row } from '../db/client.js'

export interface MeetingTranscriptSegment {
  speaker: string | null
  start_ms: number | null
  end_ms: number | null
  text: string
}

export interface MeetingImportRow extends Row {
  id: string
  action_id: string
  meeting_id: string | null
  meeting_code: string | null
  sub_meeting_id: string | null
  meeting_title: string | null
  started_at: Date | string | null
  ended_at: Date | string | null
  participants: string[]
  summary: string | null
  minutes: string | null
  todos: string[]
  transcript: string | null
  transcript_segments: MeetingTranscriptSegment[]
  content_source: string
  imported_by: string | null
  imported_at: Date | string
}

export interface SaveMeetingImportInput {
  actionId: string
  meetingId?: string | null
  meetingCode?: string | null
  subMeetingId?: string | null
  meetingTitle?: string | null
  startedAt?: string | null
  endedAt?: string | null
  participants: string[]
  summary?: string | null
  minutes?: string | null
  todos: string[]
  transcript?: string | null
  transcriptSegments: MeetingTranscriptSegment[]
  contentSource: 'minutes' | 'smart_minutes'
  importedBy: string
}

export async function getMeetingImport(db: Db, actionId: string): Promise<MeetingImportRow | null> {
  const result = await db.query<MeetingImportRow>(
    'SELECT * FROM action_meeting_imports WHERE action_id = $1',
    [actionId],
  )
  return result.rows[0] ?? null
}

export async function saveMeetingImport(
  db: Db,
  input: SaveMeetingImportInput,
): Promise<MeetingImportRow> {
  const result = await db.query<MeetingImportRow>(
    `INSERT INTO action_meeting_imports
       (action_id, meeting_id, meeting_code, sub_meeting_id, meeting_title, started_at, ended_at,
        participants, summary, minutes, todos, transcript, transcript_segments, content_source, imported_by, imported_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
             $8::jsonb, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15, now())
     ON CONFLICT (action_id)
     DO UPDATE SET
       meeting_id = EXCLUDED.meeting_id,
       meeting_code = EXCLUDED.meeting_code,
       sub_meeting_id = EXCLUDED.sub_meeting_id,
       meeting_title = EXCLUDED.meeting_title,
       started_at = EXCLUDED.started_at,
       ended_at = EXCLUDED.ended_at,
       participants = EXCLUDED.participants,
       summary = EXCLUDED.summary,
       minutes = EXCLUDED.minutes,
       todos = EXCLUDED.todos,
       transcript = EXCLUDED.transcript,
       transcript_segments = EXCLUDED.transcript_segments,
       content_source = EXCLUDED.content_source,
       imported_by = EXCLUDED.imported_by,
       imported_at = now()
     RETURNING *`,
    [
      input.actionId,
      input.meetingId ?? null,
      input.meetingCode ?? null,
      input.subMeetingId ?? null,
      input.meetingTitle ?? null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.participants,
      input.summary ?? null,
      input.minutes ?? null,
      input.todos,
      input.transcript ?? null,
      input.transcriptSegments,
      input.contentSource,
      input.importedBy,
    ],
  )
  return result.rows[0]!
}

export function meetingImportToApi(row: MeetingImportRow): Record<string, unknown> {
  return {
    id: row.id,
    action_id: row.action_id,
    meeting_id: row.meeting_id,
    meeting_code: row.meeting_code,
    sub_meeting_id: row.sub_meeting_id,
    meeting_title: row.meeting_title,
    started_at: row.started_at,
    ended_at: row.ended_at,
    participants: row.participants ?? [],
    summary: row.summary,
    minutes: row.minutes,
    todos: row.todos ?? [],
    transcript: row.transcript,
    transcript_segments: row.transcript_segments ?? [],
    content_source: row.content_source,
    imported_at: row.imported_at,
  }
}
