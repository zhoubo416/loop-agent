import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { ApiError } from '../http/errors.js'
import { config } from '../config.js'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function encryptionKey(): Buffer {
  const raw = config.tencentMeetingTokenEncryptionKey.trim()
  if (!raw) {
    throw new ApiError(
      'INTEGRATION_NOT_CONFIGURED',
      '服务端未配置 TENCENT_MEETING_TOKEN_ENCRYPTION_KEY',
    )
  }

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new ApiError(
      'INTEGRATION_NOT_CONFIGURED',
      'TENCENT_MEETING_TOKEN_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64 密钥',
    )
  }
  return key
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split('.')
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new ApiError('INTEGRATION_AUTH_FAILED', '腾讯会议凭证格式无效')
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivValue, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new ApiError('INTEGRATION_AUTH_FAILED', '腾讯会议凭证无法解密')
  }
}
