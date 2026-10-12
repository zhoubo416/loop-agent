import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import pg from 'pg'
import { config } from '../config.js'

export type Row = Record<string, unknown>

export interface QueryResult<T = Row> {
  rows: T[]
  rowCount: number
}

export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** 执行多语句脚本(不带参数),用于 migration 这类场景 */
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
  describe(): string
}

function toJsonParam(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

class PgDb implements Db {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      // 托管 PostgreSQL(例如 Neon)会主动关闭长时间空闲的连接,
      // 这里先于对方回收,并保证空闲连接出错不会让进程崩溃
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      connectionTimeoutMillis: 15_000,
    })
    this.pool.on('error', (error) => {
      console.warn('[db] 空闲数据库连接出错,连接池已丢弃该连接:', error.message)
    })
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return withTransientRetry(async () => {
      const result = await this.pool.query(sql, params.map(normalizeParam))
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 }
    })
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return withTransientRetry(() => this.runTransaction(fn))
  }

  private async runTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    // 连接在使用过程中被对端关闭时,先接住 error 事件,让 query 自己抛出可诊断的错误
    const onClientError = (error: Error) => {
      console.warn('[db] 连接出错:', error.message)
    }
    client.on('error', onClientError)
    const tx: Db = {
      query: async <R = Row>(sql: string, params: unknown[] = []) => {
        const result = await client.query(sql, params.map(normalizeParam))
        return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 }
      },
      exec: async (script: string) => {
        await client.query(script)
      },
      transaction: () => {
        throw new Error('不支持嵌套事务')
      },
      close: async () => {},
      describe: () => 'pg(transaction)',
    }
    try {
      await client.query('BEGIN')
      const result = await fn(tx)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.off('error', onClientError)
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  describe(): string {
    return 'postgres(pg)'
  }
}

/**
 * PGlite 只有一个连接,同一时刻只能有一个事务。
 * 这里用一个串行队列保证事务不重叠,行为等价于单写者数据库。
 */
class PGliteDb implements Db {
  private readonly db: PGlite
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true })
    this.db = new PGlite(dataDir)
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    await this.ready()
    const result = await this.db.query<T>(sql, params.map(normalizeParam))
    return {
      rows: result.rows as T[],
      rowCount: result.affectedRows ?? result.rows.length,
    }
  }

  async exec(sql: string): Promise<void> {
    await this.ready()
    await this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    await this.ready()
    const run = this.queue.then(async () => {
      return this.db.transaction(async (txRaw) => {
        const tx: Db = {
          query: async <R = Row>(sql: string, params: unknown[] = []) => {
            const result = await txRaw.query<R>(sql, params.map(normalizeParam))
            return {
              rows: result.rows as R[],
              rowCount: result.affectedRows ?? result.rows.length,
            }
          },
          exec: async (script: string) => {
            await txRaw.exec(script)
          },
          transaction: () => {
            throw new Error('不支持嵌套事务')
          },
          close: async () => {},
          describe: () => 'pglite(transaction)',
        }
        return fn(tx)
      })
    })
    this.queue = run.catch(() => {})
    return run as Promise<T>
  }

  private async ready(): Promise<void> {
    if (this.closed) throw new Error('数据库已关闭')
    await this.db.waitReady
  }

  async close(): Promise<void> {
    this.closed = true
    await this.db.close()
  }

  describe(): string {
    return 'pglite(embedded)'
  }
}

function normalizeParam(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const proto = Object.getPrototypeOf(value)
    if (proto === Object.prototype || proto === null || Array.isArray(value)) {
      return JSON.stringify(value)
    }
  }
  return value
}

function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code && ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '08000', '08003', '08006', '57P01'].includes(code)) {
    return true
  }
  const message = (error as { message?: string }).message ?? ''
  return /Connection terminated|connection is closed|Client has encountered a connection error|Connection ended/i.test(
    message,
  )
}

/**
 * 托管数据库会回收空闲连接,重试一次可以吸收这类瞬时故障。
 * 只对连接层错误重试,业务错误(例如唯一约束冲突)不会被重试。
 */
async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error
    console.warn('[db] 检测到连接被断开,重试一次:', (error as Error).message)
    return fn()
  }
}

export { toJsonParam }

let instance: Db | undefined

export function getDb(): Db {
  if (!instance) {
    instance = config.databaseUrl ? new PgDb(config.databaseUrl) : new PGliteDb(config.pgliteDataDir)
  }
  return instance
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close()
    instance = undefined
  }
}
