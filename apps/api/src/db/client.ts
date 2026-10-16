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
    const run = async () => {
      const result = await this.pool.query(sql, params.map(normalizeParam))
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 }
    }
    // 只有读语句能自动重试:写语句可能在服务端已经执行、只是响应没回来,
    // 重试会把同一条写再做一遍,留下重复数据
    return isReadOnlyStatement(sql) ? withTransientRetry(run) : run()
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    try {
      return await this.runTransaction(fn)
    } catch (error) {
      // 事务在提交之前被连接中断:没提交的东西数据库会回滚,整段重来是安全的
      if (!(error instanceof PreCommitConnectionError)) throw error
      console.warn('[db] 事务在提交前被连接中断,重试一次:', error.message)
      return this.runTransaction(fn)
    }
  }

  private async runTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    let client: pg.PoolClient
    try {
      client = await this.pool.connect()
    } catch (error) {
      // 连接还没拿到就失败了:什么都没执行,重来是安全的
      if (isTransientConnectionError(error)) throw new PreCommitConnectionError(error)
      throw error
    }
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
    let committing = false
    let broken = false
    try {
      await client.query('BEGIN')
      const result = await fn(tx)
      committing = true
      await client.query('COMMIT')
      return result
    } catch (error) {
      broken = isTransientConnectionError(error)
      await client.query('ROLLBACK').catch(() => {})
      // COMMIT 已经发出去之后才失败时,"到底提交没提交"无法判断,不能重来
      if (broken && !committing) throw new PreCommitConnectionError(error)
      throw error
    } finally {
      client.off('error', onClientError)
      // 连接坏了就不要还回池子里,免得下一条语句一定失败
      client.release(broken ? new Error('连接已断开') : undefined)
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

/** PostgreSQL 唯一约束冲突 */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null | undefined)?.code === '23505'
}

/**
 * 语句能不能自动重试。
 *
 * 只认 select:写语句可能在服务端已经执行、只是响应没回来,重试会把同一条写再做一遍。
 * 认不出来的一律当成写(包括 WITH 开头的语句,它可能带写操作),宁可少重试也不要写重复数据。
 */
export function isReadOnlyStatement(sql: string): boolean {
  return /^\s*select\b/i.test(sql)
}

/**
 * 事务在提交之前被连接中断。这时数据库会把没提交的东西回滚掉,
 * 整段重来做一遍是安全的;提交阶段本身失败则不能重来,因为无法判断提交有没有生效。
 */
class PreCommitConnectionError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PreCommitConnectionError'
  }
}

/**
 * 对连接层错误重试。
 *
 * 只用在"重复执行没有副作用"的操作上:读语句、以及整体幂等的启动步骤(建表、migration、
 * 开发用户兜底)。写语句不能走这里,原因见 isReadOnlyStatement。
 * 业务错误(例如唯一约束冲突)不会被重试。
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error
      lastError = error
      if (attempt < attempts) {
        console.warn(`[db] 检测到连接被断开,第 ${attempt} 次重试:`, (error as Error).message)
        // 让池子把坏连接丢掉,隔一下再试
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
  }
  throw lastError
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
