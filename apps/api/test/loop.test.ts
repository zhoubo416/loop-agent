import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { AgentEngine } from '../src/agent/engine.js'

const dataDir = path.resolve(import.meta.dirname, '../.data/test-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.PGDATA_DIR = dataDir
delete process.env.DATABASE_URL
process.env.WORKER_ENABLED = 'false'

const { buildServer } = await import('../src/http/server.js')
const { getDb, closeDb } = await import('../src/db/client.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { ensureDevUser } = await import('../src/db/seed.js')
const { RuntimeWorker } = await import('../src/runtime/worker.js')
const { processDueSchedules } = await import('../src/runtime/scheduler.js')
const { setEngine } = await import('../src/agent/engine-factory.js')
const { ScriptedEngine } = await import('./support/scripted-engine.js')

setEngine(new ScriptedEngine())

const app = buildServer()

let projectId = ''
let devUserId = ''
let secondUserId = ''
let sessionId = ''

async function api(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const response = await app.inject({
    method: method as 'GET',
    url,
    headers: { 'content-type': 'application/json', 'x-user-id': devUserId, ...headers },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
  const text = response.body
  return { status: response.statusCode, json: text ? JSON.parse(text) : null }
}

async function drainWorker(): Promise<number> {
  return new RuntimeWorker('test-worker').drain()
}

async function runList(project: string, query = ''): Promise<any[]> {
  const result = await api('GET', `/api/v1/projects/${project}/runs${query}`)
  return result.json.items
}

before(async () => {
  await runMigrations({ quiet: true })
  await app.ready()

  const dev = await ensureDevUser()
  devUserId = dev.id

  const db = getDb()
  const created = await db.query<{ id: string }>(
    `INSERT INTO users (name, email) VALUES ('外部用户', 'outsider@loop.local')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  )
  secondUserId = created.rows[0]!.id
})

after(async () => {
  await app.close()
  await closeDb()
})

test('未携带 X-User-Id 的请求被拒绝', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/projects' })
  assert.equal(response.statusCode, 401)
})

test('可以创建 Project,并自动生成当前 State 与 owner 成员', async () => {
  const created = await api('POST', '/api/v1/projects', {
    name: '蛋白 X 机制研究',
    objective: '验证蛋白 X 是否影响肿瘤细胞增殖。',
    description: '第一轮细胞实验与后续数据分析。',
    success_criteria: ['完成第一轮实验', '完成数据分析'],
    constraints: { deadline: '2027-06-30' },
  })
  assert.equal(created.status, 201)
  projectId = created.json.id
  assert.equal(created.json.status, 'created')

  const state = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.equal(state.json.version, 1)

  const members = await api('GET', `/api/v1/projects/${projectId}/members`)
  assert.equal(members.json.items.length, 1)
  assert.equal(members.json.items[0].role, 'owner')
})

test('Chat 触发 Agent,结构性 State 变更进入待确认,Action 先 proposed', async () => {
  const chat = await api('POST', `/api/v1/projects/${projectId}/chat`, {
    content: '我们已经完成第一轮实验,结果基本符合预期。',
  })
  assert.equal(chat.status, 202)
  assert.ok(chat.json.agent_run_id)
  sessionId = chat.json.session_id

  await drainWorker()

  const run = await api('GET', `/api/v1/projects/${projectId}/runs/${chat.json.agent_run_id}`)
  assert.equal(run.json.status, 'completed')

  const state = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.match(state.json.current_situation, /第一轮实验/)
  assert.equal(state.json.version, 2)
  assert.equal(state.json.current_stage, '未开始')

  const proposals = await api('GET', `/api/v1/projects/${projectId}/state/proposals?status=pending`)
  assert.equal(proposals.json.items.length, 1)
  assert.equal(proposals.json.items[0].proposal.currentStage, '结果分析')

  const actions = await api('GET', `/api/v1/projects/${projectId}/actions`)
  assert.equal(actions.json.items.length, 1)
  assert.equal(actions.json.items[0].status, 'proposed')
  assert.equal(state.json.active_actions.length, 0)

  const events = await api('GET', `/api/v1/projects/${projectId}/events`)
  assert.equal(events.json.items.length, 1)

  const recommendations = await api('GET', `/api/v1/projects/${projectId}/recommendations`)
  assert.equal(recommendations.json.items.length, 1)

  const messages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${sessionId}/messages`,
  )
  assert.deepEqual(messages.json.items.map((item: { role: string }) => item.role), [
    'user',
    'assistant',
  ])
})

test('应用 State Proposal 后,阶段才真正变更', async () => {
  const proposals = await api('GET', `/api/v1/projects/${projectId}/state/proposals?status=pending`)
  const proposalId = proposals.json.items[0].id

  const applied = await api(
    'POST',
    `/api/v1/projects/${projectId}/state/proposals/${proposalId}/apply`,
    {},
  )
  assert.equal(applied.status, 200)
  assert.equal(applied.json.status, 'applied')

  const state = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.equal(state.json.current_stage, '结果分析')

  const again = await api(
    'POST',
    `/api/v1/projects/${projectId}/state/proposals/${proposalId}/apply`,
    {},
  )
  assert.equal(again.status, 409)
})

test('确认 Action 后才进入可执行状态并出现在 State 里', async () => {
  const actions = await api('GET', `/api/v1/projects/${projectId}/actions`)
  const actionId = actions.json.items[0].id

  const confirmed = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${actionId}/confirm`,
    {},
  )
  assert.equal(confirmed.json.status, 'pending')

  const state = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.equal(state.json.active_actions.length, 1)
})

test('Action 完成产生 Execution、Result 与 Observation,并再次唤醒 Agent', async () => {
  const actions = await api('GET', `/api/v1/projects/${projectId}/actions?status=pending`)
  const actionId = actions.json.items[0].id

  const completed = await api('POST', `/api/v1/projects/${projectId}/actions/${actionId}/complete`, {
    result: { summary: '第一轮实验数据分析完成,结果比较稳定。', output: { p_value: 0.03 } },
  })
  assert.equal(completed.json.status, 'completed')
  assert.ok(completed.json.execution_id)
  assert.ok(completed.json.observation_id)
  assert.ok(completed.json.agent_run_id)

  await drainWorker()

  const action = await api('GET', `/api/v1/projects/${projectId}/actions/${actionId}`)
  assert.equal(action.json.status, 'completed')
  assert.equal(action.json.executions.length, 1)
  assert.match(action.json.executions[0].output.summary, /分析完成/)

  const state = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.match(state.json.current_situation, /数据分析完成/)
})

test('Action 失败会产生失败 Execution,并把问题带回 Agent', async () => {
  const created = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '复现第二组实验',
    executor_type: 'human',
    priority: 'high',
  })
  assert.equal(created.json.status, 'pending')
  const actionId = created.json.id

  const failed = await api('POST', `/api/v1/projects/${projectId}/actions/${actionId}/fail`, {
    reason: '实验条件不稳定,第一次尝试失败',
  })
  assert.equal(failed.json.status, 'failed')

  await drainWorker()

  const action = await api('GET', `/api/v1/projects/${projectId}/actions/${actionId}`)
  assert.equal(action.json.status, 'failed')

  const recommendations = await api(
    'GET',
    `/api/v1/projects/${projectId}/recommendations?status=pending`,
  )
  assert.ok(recommendations.json.items.length >= 1)
})

test('拒绝 Recommendation 后,State 不发生错误变化', async () => {
  const before = await api('GET', `/api/v1/projects/${projectId}/state`)

  const pending = await api('GET', `/api/v1/projects/${projectId}/recommendations?status=pending`)
  const recommendation = pending.json.items[0]
  assert.ok(recommendation)

  const rejected = await api(
    'POST',
    `/api/v1/projects/${projectId}/recommendations/${recommendation.id}/reject`,
    { reason: '目前不采用' },
  )
  assert.equal(rejected.json.status, 'rejected')

  const after = await api('GET', `/api/v1/projects/${projectId}/state`)
  assert.equal(after.json.version, before.json.version)
  assert.equal(JSON.stringify(after.json.open_issues), JSON.stringify(before.json.open_issues))
})

test('接受 Recommendation 可以生成 Action', async () => {
  const pending = await api('GET', `/api/v1/projects/${projectId}/recommendations?status=pending`)
  const recommendation = pending.json.items[0]
  assert.ok(recommendation)

  const accepted = await api(
    'POST',
    `/api/v1/projects/${projectId}/recommendations/${recommendation.id}/accept`,
    { create_action: true, title: '按建议确认实验条件' },
  )
  assert.equal(accepted.json.status, 'executed')
  assert.ok(accepted.json.action.id)
  assert.equal(accepted.json.action.status, 'pending')
})

test('重复的幂等键不会产生第二个 Observation', async () => {
  const headers = { 'idempotency-key': 'client-request-001' }
  const body = { type: 'user_input', content: '记录一次幂等测试输入。' }

  const first = await api('POST', `/api/v1/projects/${projectId}/observations`, body, headers)
  const second = await api('POST', `/api/v1/projects/${projectId}/observations`, body, headers)

  assert.equal(first.status, 202)
  assert.equal(second.status, 200)
  assert.equal(second.json.id, first.json.id)
  assert.equal(second.json.replayed, true)

  const db = getDb()
  const count = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM observations WHERE content = $1`,
    [body.content],
  )
  assert.equal(count.rows[0]!.count, '1')

  await drainWorker()
})

test('同一个 Schedule 的执行窗口只会触发一次 Agent Run', async () => {
  const created = await api('POST', `/api/v1/projects/${projectId}/schedules`, {
    type: 'cron',
    expression: '0 9 * * *',
    payload: { instruction: '检查项目是否存在风险' },
  })
  assert.equal(created.status, 201)

  const db = getDb()
  const window = '2026-01-05T09:00:00.000Z'
  await db.query('UPDATE schedules SET next_run_at = $2::timestamptz WHERE id = $1', [
    created.json.id,
    window,
  ])
  assert.equal(await processDueSchedules(), 1)

  await db.query('UPDATE schedules SET next_run_at = $2::timestamptz WHERE id = $1', [
    created.json.id,
    window,
  ])
  assert.equal(await processDueSchedules(), 0)

  await drainWorker()
  const runs = await runList(projectId, '?trigger_type=schedule')
  assert.equal(runs.length, 1)
})

test('两个 Worker 并发消费时,State 不会被覆盖', async () => {
  await api('POST', `/api/v1/projects/${projectId}/observations`, {
    type: 'user_input',
    content: '第一次并发输入:第二轮实验准备开始。',
  })
  await api('POST', `/api/v1/projects/${projectId}/observations`, {
    type: 'user_input',
    content: '第二次并发输入:第二轮实验已经排期。',
  })

  const workerA = new RuntimeWorker('worker-a')
  const workerB = new RuntimeWorker('worker-b')
  for (let i = 0; i < 12; i += 1) {
    await Promise.all([workerA.tick(), workerB.tick()])
  }

  const db = getDb()
  const running = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agent_runs WHERE project_id = $1 AND status = 'running'`,
    [projectId],
  )
  assert.equal(running.rows[0]!.count, '0')

  const pending = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agent_runs WHERE project_id = $1 AND status = 'pending'`,
    [projectId],
  )
  assert.equal(pending.rows[0]!.count, '0')

  const versions = await db.query<{ version: number }>(
    `SELECT version FROM agent_state_versions WHERE project_id = $1 ORDER BY version`,
    [projectId],
  )
  const list = versions.rows.map((row) => row.version)
  assert.deepEqual(list, Array.from({ length: list.length }, (_, index) => index + 1))
})

test('乐观锁冲突会被识别', async () => {
  const { applyStateProposal } = await import('../src/modules/states.js')
  const db = getDb()
  const state = await db.query<{ version: number }>(
    'SELECT version FROM agent_states WHERE project_id = $1',
    [projectId],
  )
  const currentVersion = state.rows[0]!.version
  await assert.rejects(
    applyStateProposal(db, projectId, { currentSituation: '一次过期的写入' }, {
      expectedVersion: currentVersion - 1,
      changedByType: 'user',
    }),
    (error: unknown) => (error as { code?: string }).code === 'STATE_CONFLICT',
  )
})

test('Project 是数据隔离边界,非成员无法访问', async () => {
  const denied = await api('GET', `/api/v1/projects/${projectId}`, undefined, {
    'x-user-id': secondUserId,
  })
  assert.equal(denied.status, 403)

  const list = await api('GET', '/api/v1/projects', undefined, { 'x-user-id': secondUserId })
  assert.equal(list.json.total, 0)

  const users = await api('GET', '/api/v1/users', undefined, { 'x-user-id': secondUserId })
  assert.deepEqual(
    users.json.items.map((item: { id: string }) => item.id),
    [secondUserId],
  )
})

test('完成闭环:Agent 提议完成,用户确认后 Project 进入 Completed', async () => {
  const created = await api('POST', '/api/v1/projects', {
    name: '一个很快结束的小项目',
    objective: '验证完成闭环。',
  })
  const shortProject = created.json.id

  await api('POST', `/api/v1/projects/${shortProject}/actions`, { title: '还没做完的事' })
  await api('POST', `/api/v1/projects/${shortProject}/runs`, {
    trigger_type: 'manual',
    instruction: '判断是否完成',
  })
  await drainWorker()

  const blocked = await api('POST', `/api/v1/projects/${shortProject}/completion/confirm`, {})
  assert.equal(blocked.status, 422)
  assert.equal(blocked.json.error.code, 'PROJECT_NOT_COMPLETABLE')

  const actions = await api('GET', `/api/v1/projects/${shortProject}/actions?status=pending`)
  await api('POST', `/api/v1/projects/${shortProject}/actions/${actions.json.items[0].id}/cancel`, {})
  await drainWorker()

  const confirmed = await api('POST', `/api/v1/projects/${shortProject}/completion/confirm`, {})
  assert.equal(confirmed.json.status, 'completed')

  const project = await api('GET', `/api/v1/projects/${shortProject}`)
  assert.equal(project.json.status, 'completed')
})

test('Event 可以关联已有 Action 并由 Agent 自动完成', async () => {
  const { insertRun } = await import('../src/modules/runs.js')
  const { processAgentOutput } = await import('../src/runtime/output-processor.js')

  const created = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '复现关联实验',
  })
  const actionId = created.json.id
  assert.equal(created.json.status, 'pending')

  const db = getDb()
  const run = await insertRun(db, {
    projectId,
    triggerType: 'observation',
    triggerId: null,
  })
  await processAgentOutput(db, run, {
    judgment: '关联实验已经完成',
    events: [{ type: 'experiment_completed', title: '关联实验完成', content: '关联实验已完成' }],
    actions: [{ id: actionId, status: 'completed', description: '确认已完成' }],
  })

  const action = await api('GET', `/api/v1/projects/${projectId}/actions/${actionId}`)
  assert.equal(action.json.status, 'completed')
  assert.equal(action.json.executions.length, 1)
  assert.equal(action.json.executions[0].executor_type, 'agent')
})

test('event 型 Schedule 在事件发生时触发 Agent', async () => {
  const before = await runList(projectId, '?trigger_type=schedule')

  const created = await api('POST', `/api/v1/projects/${projectId}/schedules`, {
    type: 'event',
    payload: { event_type: 'schedule_probe', instruction: '有事件发生,检查一下' },
  })
  assert.equal(created.status, 201)

  await api('POST', `/api/v1/projects/${projectId}/events`, {
    type: 'schedule_probe',
    title: '触发事件',
    content: '用来触发 event 型 Schedule 的事件',
  })
  await drainWorker()

  const after = await runList(projectId, '?trigger_type=schedule')
  assert.ok(after.length > before.length)
})

test('timeline 支持游标分页且两页不重叠', async () => {
  const first = await api('GET', `/api/v1/projects/${projectId}/timeline?limit=3`)
  assert.equal(first.json.items.length, 3)
  assert.ok(first.json.next_cursor)

  const second = await api(
    'GET',
    `/api/v1/projects/${projectId}/timeline?limit=3&cursor=${encodeURIComponent(first.json.next_cursor)}`,
  )
  assert.ok(second.json.items.length > 0)

  const firstIds = new Set(first.json.items.map((item: { id: string }) => item.id))
  const overlap = second.json.items.some((item: { id: string }) => firstIds.has(item.id))
  assert.equal(overlap, false)
})

test('过期的 in_progress 幂等键会被回收并允许重试', async () => {
  const { withIdempotency, cleanupStaleIdempotency } = await import('../src/modules/idempotency.js')
  const db = getDb()

  await db.query(
    `INSERT INTO idempotency_keys (scope, key, status, created_at)
     VALUES ('reclaim-test', 'k1', 'in_progress', now() - interval '10 minutes')`,
  )
  assert.ok((await cleanupStaleIdempotency(db)) >= 1)

  const result = await withIdempotency('reclaim-test', 'k1', async () => ({ ran: true }))
  assert.equal(result.replayed, false)
  assert.equal(result.value.ran, true)
})

test('Project 可以归档,归档后不接受新触发', async () => {
  const created = await api('POST', '/api/v1/projects', { name: '归档测试', objective: '验证归档' })
  const id = created.json.id

  await api('POST', `/api/v1/projects/${id}/archive`, {})
  const project = await api('GET', `/api/v1/projects/${id}`)
  assert.equal(project.json.status, 'archived')

  const obs = await api('POST', `/api/v1/projects/${id}/observations`, {
    type: 'user_input',
    content: '归档后不应再接受',
  })
  assert.equal(obs.status, 409)
})

test('工具注册表提供三个工具,并能读写 tool_calls', async () => {
  const { createAgentToolContext } = await import('../src/tools/registry.js')
  const db = getDb()
  const run = await db.query<{ id: string }>(
    `INSERT INTO agent_runs (project_id, trigger_type, status)
     VALUES ($1, 'manual', 'completed') RETURNING id`,
    [projectId],
  )
  const runId = run.rows[0]!.id

  const toolContext = createAgentToolContext(db, { projectId, runId })
  assert.deepEqual(
    toolContext.descriptors.map((descriptor) => descriptor.name),
    ['get_project_state', 'create_action', 'complete_action'],
  )

  const state = await toolContext.execute('get_project_state', {}) as Record<string, unknown>
  assert.ok('version' in state)

  const created = await toolContext.execute('create_action', {
    title: '工具创建的行动',
    priority: 'high',
  }) as { id: string; status: string }
  assert.equal(created.status, 'proposed')

  const completed = await toolContext.execute('complete_action', {
    action_id: created.id,
    summary: '工具完成',
  }) as { status: string }
  assert.equal(completed.status, 'completed')

  const calls = await db.query<{ tool_name: string; status: string }>(
    'SELECT tool_name, status FROM tool_calls WHERE agent_run_id = $1 ORDER BY started_at',
    [runId],
  )
  assert.deepEqual(
    calls.rows.map((row) => row.tool_name),
    ['get_project_state', 'create_action', 'complete_action'],
  )
  assert.ok(calls.rows.every((row) => row.status === 'completed'))
})

test('Agent Run 会把工具执行器传给 Engine,工具副作用真实落库', async () => {
  const capturing: AgentEngine = {
    name: 'tool-capture',
    async run(input, tools) {
      if (!tools) throw new Error('没有拿到工具执行器')
      const created = (await tools.execute('create_action', {
        title: `通过工具创建:${input.observations[0]?.content ?? '无'}`,
        priority: 'medium',
      })) as { id: string }
      return {
        judgment: `已通过工具创建行动 ${created.id}`,
        recommendations: [],
      }
    },
    async healthCheck() {
      return { ok: true }
    },
  }

  setEngine(capturing)
  try {
    const obs = await api('POST', `/api/v1/projects/${projectId}/observations`, {
      type: 'user_input',
      content: '触发工具调用的一次输入。',
    })
    await drainWorker()

    const actions = await api('GET', `/api/v1/projects/${projectId}/actions?status=proposed`)
    assert.ok(
      actions.json.items.some((item: { title: string }) =>
        item.title.startsWith('通过工具创建:'),
      ),
    )

    const db = getDb()
    const calls = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tool_calls
       WHERE agent_run_id = $1 AND tool_name = 'create_action'`,
      [obs.json.agent_run.id],
    )
    assert.equal(calls.rows[0]!.count, '1')
  } finally {
    setEngine(new ScriptedEngine())
  }
})

test('Risk Engine 能识别长期无进展与连续失败', async () => {
  const { computeRisks } = await import('../src/runtime/risk-engine.js')
  const db = getDb()

  const stale = await db.query<{ id: string }>(
    `INSERT INTO actions (project_id, title, executor_type, status, priority, created_at, updated_at)
     VALUES ($1, '卡住很久的行动', 'human', 'pending', 'medium',
             now() - interval '10 days', now() - interval '10 days')
     RETURNING id`,
    [projectId],
  )

  const failing = await db.query<{ id: string }>(
    `INSERT INTO actions (project_id, title, executor_type, status, priority)
     VALUES ($1, '反复失败的行动', 'human', 'failed', 'high')
     RETURNING id`,
    [projectId],
  )
  for (let i = 0; i < 3; i += 1) {
    await db.query(
      `INSERT INTO executions (action_id, executor_type, status, output, started_at, completed_at)
       VALUES ($1, 'human', 'failed', '{}', now() - interval '1 day', now())`,
      [failing.rows[0]!.id],
    )
  }

  const risks = await computeRisks(db, projectId)
  assert.ok(risks.some((risk) => risk.id === `stale_action:${stale.rows[0]!.id}`))
  assert.ok(risks.some((risk) => risk.id === `consecutive_failures:${failing.rows[0]!.id}`))
})

test('Agent 产出建议后生成通知,并可标记已读', async () => {
  const before = await api('GET', '/api/v1/notifications/unread-count')

  await api('POST', `/api/v1/projects/${projectId}/chat`, {
    content: '通知测试:这轮实验也完成了。',
  })
  await drainWorker()

  const list = await api('GET', '/api/v1/notifications')
  assert.ok(list.json.items.length > 0)
  assert.ok(list.json.unread_count >= before.json.count + 1)

  const target = list.json.items.find((item: { status: string }) => item.status === 'unread')
  assert.ok(target)
  await api('POST', `/api/v1/notifications/${target.id}/read`, {})

  const afterOne = await api('GET', '/api/v1/notifications/unread-count')
  assert.ok(afterOne.json.count < list.json.unread_count)

  await api('POST', '/api/v1/notifications/read-all', {})
  const zero = await api('GET', '/api/v1/notifications/unread-count')
  assert.equal(zero.json.count, 0)
})

test('注册、登录、token 鉴权与登出', async () => {
  const register = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'alice@loop.local', password: 'password123', name: 'Alice' }),
  })
  assert.equal(register.statusCode, 201)
  const token = register.json().token as string
  assert.ok(token)

  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json().email, 'alice@loop.local')

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'alice@loop.local', password: 'password123' }),
  })
  assert.equal(login.statusCode, 200)
  assert.ok(login.json().token)

  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'alice@loop.local', password: 'wrong-password' }),
  })
  assert.equal(bad.statusCode, 401)

  const projects = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(projects.statusCode, 200)
  assert.equal(projects.json().total, 0)

  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${token}` },
  })
  const afterLogout = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(afterLogout.statusCode, 401)
})

test('完成 meeting 型 Action 会采集结构化结果并写进 Observation', async () => {
  const created = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '开一次方案评审会',
    kind: 'meeting',
  })
  assert.equal(created.json.kind, 'meeting')
  const actionId = created.json.id

  const completed = await api('POST', `/api/v1/projects/${projectId}/actions/${actionId}/complete`, {
    result: {
      summary: '评审通过,进入下一轮',
      output: {
        participants: ['张三', '李四'],
        decisions: ['采用方案 A'],
        action_items: ['补充对照组'],
      },
    },
  })
  assert.equal(completed.json.status, 'completed')

  const action = await api('GET', `/api/v1/projects/${projectId}/actions/${actionId}`)
  const execution = action.json.executions[0]
  assert.equal(execution.output.kind, 'meeting')
  assert.deepEqual(execution.output.decisions, ['采用方案 A'])

  const observation = await api(
    'GET',
    `/api/v1/projects/${projectId}/observations/${completed.json.observation_id}`,
  )
  assert.match(observation.json.content, /参与人:张三、李四/)
  assert.match(observation.json.content, /决定:采用方案 A/)
  assert.match(observation.json.content, /后续行动:补充对照组/)
})

test('完成 Action 后能追溯到智能体的分析结论', async () => {
  const created = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '分析第一轮数据',
    kind: 'task',
  })
  const actionId = created.json.id

  const completed = await api('POST', `/api/v1/projects/${projectId}/actions/${actionId}/complete`, {
    result: { summary: '数据分析完成,结果稳定', output: { results: ['抑制率 35%'] } },
  })
  assert.ok(completed.json.agent_run_id)
  await drainWorker()

  const detail = await api('GET', `/api/v1/projects/${projectId}/actions/${actionId}`)
  assert.ok(Array.isArray(detail.json.analysis))
  assert.ok(detail.json.analysis.length >= 1)
  const first = detail.json.analysis[0]
  assert.ok(first.judgment || first.recommendations.length > 0)
})

test('Action 详情带出来源(触发信息与智能体判断)', async () => {
  await api('POST', `/api/v1/projects/${projectId}/chat`, {
    content: '来源追踪:第三轮实验完成了。',
  })
  await drainWorker()

  const actions = await api('GET', `/api/v1/projects/${projectId}/actions?status=proposed`)
  const action = actions.json.items.find((item: { title: string }) =>
    item.title.includes('第三轮实验'),
  )
  assert.ok(action)

  const detail = await api('GET', `/api/v1/projects/${projectId}/actions/${action.id}`)
  assert.ok(detail.json.source)
  assert.ok(detail.json.source.run)
  assert.ok(detail.json.source.run.observation)
  assert.match(detail.json.source.run.observation.content, /第三轮实验/)
  assert.ok(detail.json.source.run.judgment)
})
