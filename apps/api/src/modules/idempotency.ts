import { ApiError } from '../http/errors.js'
import type { Db } from '../db/client.js'

const IN_PROGRESS_TTL = '5 minutes'

export interface IdempotentResult<T> {
  value: T
  replayed: boolean
}

/**
 * HTTP 层幂等:同一 scope + key 的请求只产生一次业务效果,后续请求回放第一次的响应。
 * 对应 docs/design/04-api-design.md 第 40 节。
 */
export async function withIdempotency<T extends object>(
  scope: string,
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (!key) {
    return { value: await fn(), replayed: false }
  }

  const { getDb } = await import('../db/client.js')
  const db: Db = getDb()

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO idempotency_keys (scope, key, status)
     VALUES ($1, $2, 'in_progress')
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING id`,
    [scope, key],
  )

  if (inserted.rows.length === 0) {
    const existing = await db.query<{ status: string; response: T }>(
      'SELECT status, response FROM idempotency_keys WHERE scope = $1 AND key = $2',
      [scope, key],
    )
    const row = existing.rows[0]
    if (!row) throw new ApiError('IDEMPOTENCY_CONFLICT', '幂等键状态异常')
    if (row.status === 'in_progress') {
      // 抢占后进程崩溃会导致 in_progress 永久残留,超过 TTL 就回收并重试
      const reclaimed = await db.query<{ id: string }>(
        `DELETE FROM idempotency_keys
         WHERE scope = $1 AND key = $2 AND status = 'in_progress'
           AND created_at < now() - interval '${IN_PROGRESS_TTL}'
         RETURNING id`,
        [scope, key],
      )
      if (reclaimed.rows.length > 0) {
        return withIdempotency(scope, key, fn)
      }
      throw new ApiError('IDEMPOTENCY_CONFLICT', '相同幂等键的请求正在处理中', { key })
    }
    return { value: row.response, replayed: true }
  }

  try {
    const value = await fn()
    await db.query(
      `UPDATE idempotency_keys SET status = 'completed', response = $3::jsonb
       WHERE scope = $1 AND key = $2`,
      [scope, key, JSON.stringify(value)],
    )
    return { value, replayed: false }
  } catch (error) {
    await db.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2', [scope, key])
    throw error
  }
}

export async function cleanupStaleIdempotency(db: Db): Promise<number> {
  const result = await db.query(
    `DELETE FROM idempotency_keys
     WHERE status = 'in_progress' AND created_at < now() - interval '${IN_PROGRESS_TTL}'`,
  )
  return result.rowCount
}
