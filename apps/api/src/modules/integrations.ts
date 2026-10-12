import type { Db } from '../db/client.js'
import { decryptSecret, encryptSecret } from '../auth/security.js'
import { ApiError } from '../http/errors.js'

const TENCENT_MEETING_PROVIDER = 'tencent_meeting'

export async function saveTencentMeetingToken(db: Db, userId: string, token: string): Promise<void> {
  const normalized = token.trim()
  if (!normalized) throw new ApiError('VALIDATION_ERROR', '腾讯会议 Token 不能为空')

  await db.query(
    `INSERT INTO user_integrations (user_id, provider, encrypted_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token, updated_at = now()`,
    [userId, TENCENT_MEETING_PROVIDER, encryptSecret(normalized)],
  )
}

export async function getTencentMeetingToken(db: Db, userId: string): Promise<string> {
  const result = await db.query<{ encrypted_token: string }>(
    'SELECT encrypted_token FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, TENCENT_MEETING_PROVIDER],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('INTEGRATION_NOT_CONFIGURED', '请先配置腾讯会议 Token')
  return decryptSecret(row.encrypted_token)
}

export async function hasTencentMeetingToken(db: Db, userId: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM user_integrations WHERE user_id = $1 AND provider = $2
     ) AS exists`,
    [userId, TENCENT_MEETING_PROVIDER],
  )
  return Boolean(result.rows[0]?.exists)
}
