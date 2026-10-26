import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'

const dataDir = path.resolve(import.meta.dirname, '../.data/runtime-reliability-test-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.PGDATA_DIR = dataDir
delete process.env.DATABASE_URL
process.env.WORKER_ENABLED = 'false'

const { getDb, closeDb } = await import('../src/db/client.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { ensureDevUser } = await import('../src/db/seed.js')
const { createProject, setProjectStatus } = await import('../src/modules/projects.js')
const {
  cancelRun,
  claimRunById,
  completeRun,
  getRun,
  insertRun,
  recoverStaleRuns,
} = await import('../src/modules/runs.js')
const { getState, applyStateProposal } = await import('../src/modules/states.js')
const { insertStateProposal } = await import('../src/modules/state-proposals.js')
const { insertMemory, retrieveMemories } = await import('../src/modules/memories.js')
const { assertActionExecutorSupported } = await import('../src/modules/actions.js')
const { insertSchedule } = await import('../src/modules/schedules.js')
const { processDueSchedules } = await import('../src/runtime/scheduler.js')

let projectId = ''

before(async () => {
  await runMigrations({ quiet: true })
  const user = await ensureDevUser()
  projectId = (
    await createProject(
      getDb(),
      { name: '可靠性测试', objective: '验证运行时恢复与上下文检索。' },
      user.id,
    )
  ).id
  await setProjectStatus(getDb(), projectId, 'active')
})

after(async () => {
  await closeDb()
})

test('Worker 可以回收失去锁的超时 running Run', async () => {
  const run = await insertRun(getDb(), { projectId, triggerType: 'manual' })
  await getDb().query(
    `UPDATE agent_runs SET status = 'running', started_at = now() - interval '10 minutes' WHERE id = $1`,
    [run.id],
  )

  assert.equal(await recoverStaleRuns(getDb(), 1_000), 1)
  const recovered = await getRun(getDb(), projectId, run.id)
  assert.equal(recovered.status, 'pending')
  assert.equal(recovered.started_at, null)
  assert.equal(recovered.error?.code, 'RUN_RECOVERED')
})

test('并发 Scheduler 只消费一个执行窗口且不会回拨下次时间', async () => {
  const schedule = await insertSchedule(getDb(), {
    projectId,
    type: 'interval',
    expression: '1h',
    payload: { instruction: '并发调度测试' },
  })
  await getDb().query(
    `UPDATE schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`,
    [schedule.id],
  )

  const [first, second] = await Promise.all([processDueSchedules(getDb()), processDueSchedules(getDb())])
  assert.equal(first + second, 1)
  const occurrences = await getDb().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM schedule_occurrences WHERE schedule_id = $1',
    [schedule.id],
  )
  assert.equal(occurrences.rows[0]?.count, '1')
  const current = await getDb().query<{ next_run_at: Date | string }>(
    'SELECT next_run_at FROM schedules WHERE id = $1',
    [schedule.id],
  )
  assert.ok(new Date(current.rows[0]!.next_run_at).getTime() > Date.now())
})

test('取消后的 Run 不能被完成或失败写回', async () => {
  const run = await insertRun(getDb(), { projectId, triggerType: 'manual' })
  const claimed = await claimRunById(getDb(), projectId, run.id)
  assert.ok(claimed)
  const cancelled = await cancelRun(getDb(), projectId, run.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(await completeRun(getDb(), run.id, { judgment: '不应落库' }), false)

  const current = await getRun(getDb(), projectId, run.id)
  assert.equal(current.status, 'cancelled')
})

test('State Proposal 使用创建时版本,过期提案不能覆盖新 State', async () => {
  const state = await getState(getDb(), projectId)
  const proposal = await insertStateProposal(
    getDb(),
    projectId,
    { currentStage: '待确认阶段' },
    null,
    state.version,
  )
  await applyStateProposal(getDb(), projectId, { currentSituation: '后来发生的新事实' })

  await assert.rejects(
    () =>
      applyStateProposal(getDb(), projectId, proposal.proposal, {
        expectedVersion: proposal.expected_version,
      }),
    (error: unknown) => (error as { code?: string }).code === 'STATE_CONFLICT',
  )
})

test('Memory 检索可以找回较早但与当前上下文相关的记忆', async () => {
  const memory = await insertMemory(getDb(), {
    projectId,
    type: 'conclusion',
    content: '早期实验确认了蛋白 X 对增殖的抑制作用',
  })
  for (let index = 0; index < 12; index += 1) {
    await insertMemory(getDb(), {
      projectId,
      type: 'context',
      content: `无关的近期记录 ${index}`,
    })
  }

  const memories = await retrieveMemories(getDb(), projectId, '实验确认蛋白 X', 3)
  assert.equal(memories[0]?.id, memory.id)
})

test('未配置的 system executor 不会被伪装成可执行能力', () => {
  assert.throws(() => assertActionExecutorSupported('system'), (error: unknown) => {
    return (error as { code?: string }).code === 'EXECUTOR_NOT_AVAILABLE'
  })
})
