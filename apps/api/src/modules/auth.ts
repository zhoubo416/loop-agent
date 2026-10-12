import type { Db, Row } from '../db/client.js'
import { ApiError } from '../http/errors.js'
import { hashPassword, hashToken, newToken, verifyPassword } from '../auth/security.js'

const TOKEN_TTL_DAYS = 30

export interface UserWithToken {
  id: string
  name: string
  email: string | null
  token: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function registerUser(
  db: Db,
  input: { email: string; password: string; name: string },
): Promise<UserWithToken> {
  const email = normalizeEmail(input.email)
  const password = input.password
  const name = input.name.trim()

  if (!email || !email.includes('@')) throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确')
  if (password.length < 8) throw new ApiError('VALIDATION_ERROR', '密码至少 8 位')
  if (!name) throw new ApiError('VALIDATION_ERROR', '名字不能为空')

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.rows[0]) throw new ApiError('VALIDATION_ERROR', '该邮箱已注册')

  const passwordHash = await hashPassword(password)
  const created = await db.query<{ id: string; name: string; email: string | null }>(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, name, email`,
    [name, email, passwordHash],
  )
  const user = created.rows[0]!
  const token = await issueToken(db, user.id)
  return { id: user.id, name: user.name, email: user.email, token }
}

export async function loginUser(
  db: Db,
  input: { email: string; password: string },
): Promise<UserWithToken> {
  const email = normalizeEmail(input.email)
  const user = await db.query<{ id: string; name: string; email: string | null; password_hash: string | null }>(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [email],
  )
  const row = user.rows[0]
  if (!row || !row.password_hash) {
    throw new ApiError('UNAUTHORIZED', '邮箱或密码不正确')
  }
  const ok = await verifyPassword(input.password, row.password_hash)
  if (!ok) throw new ApiError('UNAUTHORIZED', '邮箱或密码不正确')
  const token = await issueToken(db, row.id)
  return { id: row.id, name: row.name, email: row.email, token }
}

export async function issueToken(db: Db, userId: string): Promise<string> {
  const token = newToken()
  await db.query(
    `INSERT INTO user_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, hashToken(token), String(TOKEN_TTL_DAYS)],
  )
  return token
}

export async function resolveTokenUser(
  db: Db,
  token: string,
): Promise<{ id: string; name: string; email: string | null } | undefined> {
  const result = await db.query<{ id: string; name: string; email: string | null }>(
    `SELECT u.id, u.name, u.email
     FROM user_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [hashToken(token)],
  )
  return result.rows[0]
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM user_tokens WHERE token_hash = $1', [hashToken(token)])
}
