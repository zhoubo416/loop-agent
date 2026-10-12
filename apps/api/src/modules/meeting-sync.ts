import type { Db } from '../db/client.js'

export interface MeetingTranscriptSegment {
  speaker: string | null
  start_at: string | null
  end_at: string | null
  text: string
}

export interface MeetingSyncRow {
  id: string
  action_id: string
  meeting_code: string
  meeting_id: string | null
  record_file_id: string | null
  meeting_title: string | null
  started_at: Date | string | null
  ended_at: Date | string | null
  participants: string[]
  summary: string | null
  todo: string | null
  transcript: string | null
  transcript_segments: MeetingTranscriptSegment[]
  synced_at: Date | string
}

export interface SaveMeetingSyncInput {
  actionId: string
  meetingCode: string
  meetingId?: string | null
  recordFileId?: string | null
  meetingTitle?: string | null
  startedAt?: string | null
  endedAt?: string | null
  participants: string[]
  summary?: string | null
  todo?: string | null
  transcript?: string | null
  transcriptSegments: MeetingTranscriptSegment[]
}

export async function getMeetingSync(db: Db, actionId: string): Promise<MeetingSyncRow | null> {
  const result = await db.query<MeetingSyncRow>(
    'SELECT * FROM action_meeting_syncs WHERE action_id = $1',
    [actionId],
  )
  return result.rows[0] ?? null
}

export async function saveMeetingSync(db: Db, input: SaveMeetingSyncInput): Promise<MeetingSyncRow> {
  const result = await db.query<MeetingSyncRow>(
    `INSERT INTO action_meeting_syncs
       (action_id, meeting_code, meeting_id, record_file_id, meeting_title, started_at, ended_at,
        participants, summary, todo, transcript, transcript_segments, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
             $8::jsonb, $9, $10, $11, $12::jsonb, now())
     ON CONFLICT (action_id)
     DO UPDATE SET
       meeting_code = EXCLUDED.meeting_code,
       meeting_id = EXCLUDED.meeting_id,
       record_file_id = EXCLUDED.record_file_id,
       meeting_title = EXCLUDED.meeting_title,
       started_at = EXCLUDED.started_at,
       ended_at = EXCLUDED.ended_at,
       participants = EXCLUDED.participants,
       summary = EXCLUDED.summary,
       todo = EXCLUDED.todo,
       transcript = EXCLUDED.transcript,
       transcript_segments = EXCLUDED.transcript_segments,
       synced_at = now()
     RETURNING *`,
    [
      input.actionId,
      input.meetingCode,
      input.meetingId ?? null,
      input.recordFileId ?? null,
      input.meetingTitle ?? null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.participants,
      input.summary ?? null,
      input.todo ?? null,
      input.transcript ?? null,
      input.transcriptSegments,
    ],
  )
  return result.rows[0]!
}
