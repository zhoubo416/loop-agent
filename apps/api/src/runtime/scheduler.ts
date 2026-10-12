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
    const scheduledAt = schedule.next_run_at
    if (!scheduledAt) continue
    const scheduledDate = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt)

    const project = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = $1', [
      schedule.project_id,
    ])
    if (project.rows[0]?.status !== 'active') {
      // Project 已暂停或结束:不再唤醒 Agent,但时间要往前推,避免反复扫描同一条
      await advanceSchedule(db, schedule, scheduledDate)
      continue
    }

    const claimed = await db.query<{ id: string }>(
      `INSERT INTO schedule_occurrences (schedule_id, scheduled_at)
       VALUES ($1, $2::timestamptz)
       ON CONFLICT (schedule_id, scheduled_at) DO NOTHING
       RETURNING id`,
      [schedule.id, scheduledDate.toISOString()],
    )

    if (claimed.rows.length === 0) {
      await advanceSchedule(db, schedule, scheduledDate)
      continue
    }

    const instruction =
      typeof schedule.payload?.instruction === 'string'
        ? (schedule.payload.instruction as string)
        : '定时检查项目状态:是否有需要关注的问题,是否有长期没有进展的行动。'

    await db.transaction(async (tx) => {
      const observation = await insertObservation(tx, {
        projectId: schedule.project_id,
        type: 'schedule',
        content: instruction,
        source: 'scheduler',
        metadata: { schedule_id: schedule.id, scheduled_at: scheduledDate.toISOString() },
      })
      const run = await insertRun(tx, {
        projectId: schedule.project_id,
        triggerType: 'schedule',
        triggerId: schedule.id,
        inputContext: {
          schedule_id: schedule.id,
          scheduled_at: scheduledDate.toISOString(),
          instruction,
          observation_id: observation.id,
        },
      })
      await tx.query(
        `UPDATE schedule_occurrences
         SET agent_run_id = $2, observation_id = $3
         WHERE schedule_id = $1 AND scheduled_at = $4::timestamptz`,
        [schedule.id, run.id, observation.id, scheduledDate.toISOString()],
      )
    })

    await advanceSchedule(db, schedule, scheduledDate)
    fired += 1
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
