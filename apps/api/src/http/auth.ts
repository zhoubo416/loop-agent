import type { FastifyRequest } from 'fastify'
import { getDb } from '../db/client.js'
import { ApiError } from './errors.js'
import { resolveTokenUser } from '../modules/auth.js'
import { config } from '../config.js'

export interface CurrentUser {
  id: string
  name: string
  email: string | null
}

/**
 * 身份解析优先使用 Bearer Token。X-User-Id 只为本地开发和测试保留,
 * 生产环境必须关闭,避免客户端通过任意用户 ID 冒充身份。
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

  if (raw && !config.allowDevUserHeader) {
    throw new ApiError('UNAUTHORIZED', '生产环境不接受 X-User-Id,请使用登录令牌')
  }
  if (!raw) {
    throw new ApiError('UNAUTHORIZED', '缺少登录令牌,无法确定身份')
  }

  const db = getDb()
  const result = await db.query<CurrentUser>('SELECT id, name, email FROM users WHERE id = $1', [raw])
  const user = result.rows[0]
  if (!user) throw new ApiError('UNAUTHORIZED', '未知用户,请检查 X-User-Id')
  return user
}
