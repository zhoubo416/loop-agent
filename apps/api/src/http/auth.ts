import type { FastifyRequest } from 'fastify'
import { getDb } from '../db/client.js'
import { ApiError } from './errors.js'
import { resolveTokenUser } from '../modules/auth.js'

export interface CurrentUser {
  id: string
  name: string
  email: string | null
}

/**
 * MVP 身份解析:所有业务接口都要求 X-User-Id,不再做无头请求回落。
 * 真正的登录体系不在 MVP 范围内,但 Project 级接口都会经过 project_users 校验。
 */
export async function resolveUser(request: FastifyRequest): Promise<CurrentUser> {
  const authorization = request.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length)
    const user = await resolveTokenUser(getDb(), token)
    if (user) return user
    throw new ApiError('UNAUTHORIZED', '登录已失效,请重新登录')
  }

  const header = request.headers['x-user-id']
  const raw = Array.isArray(header) ? header[0] : header

  if (!raw) {
    throw new ApiError('UNAUTHORIZED', '缺少 X-User-Id,无法确定身份')
  }

  const db = getDb()
  const result = await db.query<CurrentUser>('SELECT id, name, email FROM users WHERE id = $1', [raw])
  const user = result.rows[0]
  if (!user) throw new ApiError('UNAUTHORIZED', '未知用户,请检查 X-User-Id')
  return user
}
