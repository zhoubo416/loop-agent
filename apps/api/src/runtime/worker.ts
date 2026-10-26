import { getDb } from '../db/client.js'
import { config } from '../config.js'
import { ApiError } from '../http/errors.js'
import {
  acquireProjectLock,
  claimNextRun,
  claimRunById,
  recoverStaleRuns,
  releaseProjectLock,
  renewProjectLock,
  requeueRun,
  getRun,
} from '../modules/runs.js'
import { executeAgentRun } from './agent-runner.js'
import type { RunOutcome } from './agent-runner.js'
import { randomUUID } from 'node:crypto'

/**
 * Agent Run Worker。
 *
 * Queue 就是 agent_runs 表本身:待运行的任务是 status = 'pending' 的记录,
 * 认领用 FOR UPDATE SKIP LOCKED,崩溃后未完成的任务仍然留在表里,不会丢。
 */
export class RuntimeWorker {
  private readonly id: string
  private timer?: NodeJS.Timeout
  private running = false

  constructor(id = `worker-${process.pid}`) {
    this.id = id
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.warn('[worker] 处理任务失败', (error as Error).message)
      })
    }, config.workerIntervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** 处理一条待运行任务;返回是否真的执行了东西 */
  async tick(): Promise<boolean> {
    if (this.running) return false
    this.running = true
    try {
      const db = getDb()
      await recoverStaleRuns(db, config.runLockTtlMs)
      const run = await claimNextRun(db)
      if (!run) return false

      const locked = await acquireProjectLock(db, run.project_id, this.id, run.id, config.runLockTtlMs)
      if (!locked) {
        // 同一个 Project 已经有 Run 在修改 State,这一条退回队列等待
        await requeueRun(db, run.id)
        return false
      }

      const heartbeat = this.startLockHeartbeat(run.project_id, run.id)
      try {
        await executeAgentRun(run.id)
        return true
      } finally {
        heartbeat.stop()
        await releaseProjectLock(db, run.project_id, this.id, run.id)
      }
    } catch (error) {
      console.warn('[worker] 处理任务失败', (error as Error).message)
      return false
    } finally {
      this.running = false
    }
  }

  /** wait=true 的同步入口也必须经过同一套认领、锁和续租逻辑。 */
  async executeNow(projectId: string, runId: string): Promise<RunOutcome> {
    const db = getDb()
    await recoverStaleRuns(db, config.runLockTtlMs)
    const run = await claimRunById(db, projectId, runId)
    if (!run) {
      const current = await getRun(db, projectId, runId)
      if (current.status === 'cancelled') {
        return { runId, status: 'skipped', detail: 'Agent Run 已取消' }
      }
      throw new ApiError('RUN_ALREADY_RUNNING', 'Agent Run 已经被其他 Worker 认领')
    }

    const holder = `sync-${randomUUID()}`
    const locked = await acquireProjectLock(db, run.project_id, holder, run.id, config.runLockTtlMs)
    if (!locked) {
      await requeueRun(db, run.id)
      throw new ApiError('RUN_CONFLICT', '同一个 Project 正在运行其他 Agent Run')
    }

    const heartbeat = this.startLockHeartbeat(run.project_id, run.id, holder)
    try {
      return await executeAgentRun(run.id)
    } finally {
      heartbeat.stop()
      await releaseProjectLock(db, run.project_id, holder, run.id)
    }
  }

  private startLockHeartbeat(
    projectId: string,
    runId: string,
    holder = this.id,
  ): { stop: () => void } {
    const intervalMs = Math.max(1_000, Math.floor(config.runLockTtlMs / 3))
    const timer = setInterval(() => {
      void renewProjectLock(getDb(), projectId, holder, runId, config.runLockTtlMs).catch((error) => {
        console.warn('[worker] 续租 Project 锁失败', (error as Error).message)
      })
    }, intervalMs)
    timer.unref()
    return { stop: () => clearInterval(timer) }
  }

  /** 把队列跑干净,主要给测试和 CLI 使用 */
  async drain(maxIterations = 50): Promise<number> {
    let processed = 0
    for (let i = 0; i < maxIterations; i += 1) {
      const did = await this.tick()
      if (!did) {
        const db = getDb()
        const pending = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM agent_runs WHERE status = 'pending'`,
        )
        if (Number.parseInt(pending.rows[0]?.count ?? '0', 10) === 0) break
        continue
      }
      processed += 1
    }
    return processed
  }
}
