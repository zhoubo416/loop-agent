import type { Db } from '../db/client.js'
import { decryptSecret, encryptSecret } from '../auth/security.js'
import { ApiError } from '../http/errors.js'

const TENCENT_MEETING_PROVIDER = 'tencent_meeting'

export interface IntegrationStatus {
  configured: boolean
  masked_token: string | null
  updated_at: Date | string | null
}

export function maskToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return '••••'
  return trimmed.length > 4 ? `••••${trimmed.slice(-4)}` : '••••'
}

export async function saveTencentMeetingToken(
  db: Db,
  userId: string,
  token: string,
): Promise<IntegrationStatus> {
  const normalized = token.trim()
  if (!normalized) throw new ApiError('VALIDATION_ERROR', '腾讯会议 Token 不能为空')

  const masked = maskToken(normalized)
  const result = await db.query<{ updated_at: Date | string }>(
    `INSERT INTO user_integrations (user_id, provider, encrypted_token, token_hint)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       encrypted_token = EXCLUDED.encrypted_token,
       token_hint = EXCLUDED.token_hint,
       updated_at = now()
     RETURNING updated_at`,
    [userId, TENCENT_MEETING_PROVIDER, encryptSecret(normalized), masked],
  )
  return {
    configured: true,
    masked_token: masked,
    updated_at: result.rows[0]?.updated_at ?? null,
  }
}

export async function getTencentMeetingToken(db: Db, userId: string): Promise<string> {
  const result = await db.query<{ encrypted_token: string }>(
    'SELECT encrypted_token FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, TENCENT_MEETING_PROVIDER],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('INTEGRATION_NOT_CONFIGURED', '请先绑定腾讯会议账号')
  return decryptSecret(row.encrypted_token)
}

export async function getTencentMeetingIntegration(
  db: Db,
  userId: string,
): Promise<IntegrationStatus> {
  const result = await db.query<{ token_hint: string | null; updated_at: Date | string }>(
    'SELECT token_hint, updated_at FROM user_integrations WHERE user_id = $1 AND provider = $2',
    [userId, TENCENT_MEETING_PROVIDER],
  )
  const row = result.rows[0]
  if (!row) return { configured: false, masked_token: null, updated_at: null }
  return {
    configured: true,
    masked_token: row.token_hint,
    updated_at: row.updated_at,
  }
}

export async function deleteTencentMeetingToken(db: Db, userId: string): Promise<void> {
  await db.query('DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2', [
    userId,
    TENCENT_MEETING_PROVIDER,
  ])
}
