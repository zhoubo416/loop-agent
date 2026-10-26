import { getDb, type Db } from '../db/client.js'
import { advanceSchedule, listDueSchedules, type ScheduleRow } from '../modules/schedules.js'
import { insertObservation } from '../modules/observations.js'
import { insertRun } from '../modules/runs.js'

/**
 * Schedule Worker。
 *
 * 幂等键是 schedule_id + scheduled_at(计划执行时间):
 * Worker 重启、重复扫描、多实例都不会让同一个窗口触发两次。
 * 对应 docs/design/03-agent-runtime.md 第 35/36 节。
 */
export async function processDueSchedules(db: Db = getDb(), limit = 10): Promise<number> {
  const due = await listDueSchedules(db, limit)
  let fired = 0

  for (const schedule of due) {
    const didFire = await db.transaction(async (tx) => {
      // 重新读取并锁住当前 Schedule,避免多个 Scheduler 用同一份旧快照把 next_run_at 回拨。
      const currentResult = await tx.query<ScheduleRow>(
        'SELECT * FROM schedules WHERE id = $1 FOR UPDATE',
        [schedule.id],
      )
      const current = currentResult.rows[0]
      if (!current?.next_run_at) return false
      const scheduledDate =
        current.next_run_at instanceof Date ? current.next_run_at : new Date(current.next_run_at)
      if (scheduledDate.getTime() > Date.now() || current.status !== 'active') return false

      const project = await tx.query<{ status: string }>('SELECT status FROM projects WHERE id = $1', [
        current.project_id,
      ])
      if (project.rows[0]?.status !== 'active') {
        // Project 已暂停或结束:不再唤醒 Agent,但时间要往前推,避免反复扫描同一条
        await advanceSchedule(tx, current, scheduledDate)
        return false
      }

      const claimed = await tx.query<{ id: string }>(
        `INSERT INTO schedule_occurrences (schedule_id, scheduled_at)
         VALUES ($1, $2::timestamptz)
         ON CONFLICT (schedule_id, scheduled_at) DO NOTHING
         RETURNING id`,
        [current.id, scheduledDate.toISOString()],
      )

      if (claimed.rows.length === 0) {
        // 兼容旧版本留下的 occurrence:推进窗口,但不重复创建 Run
        await advanceSchedule(tx, current, scheduledDate)
        return false
      }

      const instruction =
        typeof current.payload?.instruction === 'string'
          ? (current.payload.instruction as string)
          : '定时检查项目状态:是否有需要关注的问题,是否有长期没有进展的行动。'
      const observation = await insertObservation(tx, {
        projectId: current.project_id,
        type: 'schedule',
        content: instruction,
        source: 'scheduler',
        metadata: { schedule_id: current.id, scheduled_at: scheduledDate.toISOString() },
      })
      const run = await insertRun(tx, {
        projectId: current.project_id,
        triggerType: 'schedule',
        triggerId: current.id,
        inputContext: {
          schedule_id: current.id,
          scheduled_at: scheduledDate.toISOString(),
          instruction,
          observation_id: observation.id,
        },
      })
      await tx.query(
        `UPDATE schedule_occurrences
         SET agent_run_id = $2, observation_id = $3
         WHERE schedule_id = $1 AND scheduled_at = $4::timestamptz`,
        [current.id, run.id, observation.id, scheduledDate.toISOString()],
      )

      await advanceSchedule(tx, current, scheduledDate)
      return true
    })
    if (didFire) fired += 1
  }

  return fired
}

/**
 * event 型 Schedule:项目里出现匹配类型的事件时触发 Agent。
 * 调用方负责放在事务里(Agent 产出事件、外部系统上报事件时都会调用)。
 */
export async function triggerEventSchedules(
  db: Db,
  projectId: string,
  eventType: string,
): Promise<number> {
  const schedules = await db.query<ScheduleRow>(
    `SELECT * FROM schedules
     WHERE project_id = $1 AND type = 'event' AND status = 'active'`,
    [projectId],
  )

  let fired = 0
  for (const schedule of schedules.rows) {
    const expectedType = schedule.payload?.event_type ?? schedule.payload?.type
    if (expectedType && expectedType !== eventType) continue

    const instruction =
      typeof schedule.payload?.instruction === 'string'
        ? (schedule.payload.instruction as string)
        : '项目里发生了新的事件,检查一下是否有需要处理的问题。'

    const observation = await insertObservation(db, {
      projectId,
      type: 'schedule',
      content: instruction,
      source: 'event_schedule',
      metadata: { schedule_id: schedule.id, event_type: eventType },
    })
    await insertRun(db, {
      projectId,
      triggerType: 'schedule',
      triggerId: schedule.id,
      inputContext: {
        schedule_id: schedule.id,
        event_type: eventType,
        instruction,
        observation_id: observation.id,
      },
    })
    fired += 1
  }
  return fired
}

export class Scheduler {
  private timer?: NodeJS.Timeout

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void processDueSchedules().catch((error) => {
        console.error('[scheduler] 处理到期 Schedule 失败', error)
      })
    }, 10_000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
