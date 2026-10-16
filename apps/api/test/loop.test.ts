import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { AgentEngine } from '../src/agent/engine.js'

const dataDir = path.resolve(import.meta.dirname, '../.data/test-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.PGDATA_DIR = dataDir
// 上传的测试文件也留在测试目录里,不污染开发环境的 .data/uploads
process.env.UPLOAD_DIR = path.resolve(dataDir, 'uploads')
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

interface ChatTurn {
  status: number
  session_id: string | null
  /** 所有 delta 事件拼起来的完整回复 */
  reply: string
  /** 所有 reasoning 事件拼起来的推理过程 */
  reasoning: string
  observation_id: string | null
  agent_run_id: string | null
  error: { code: string; message: string } | null
  /** 还没切开 SSE 就失败时的普通错误响应 */
  json: any
}

/**
 * 对话接口返回的是 SSE 流,这里把事件拼成一次调用的结果,
 * 断言方式和它还是一段 JSON 时一样。
 */
async function sendChat(project: string, body: Record<string, unknown>): Promise<ChatTurn> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project}/chat`,
    headers: { 'content-type': 'application/json', 'x-user-id': devUserId },
    payload: JSON.stringify(body),
  })
  const events = parseSse(response.body)
  const of = (name: string) => events.find((item) => item.name === name)?.data
  const joined = (name: string) =>
    events
      .filter((item) => item.name === name)
      .map((item) => item.data.text as string)
      .join('')
  return {
    status: response.statusCode,
    session_id: of('session')?.session_id ?? null,
    reply: joined('delta'),
    reasoning: joined('reasoning'),
    observation_id: of('done')?.observation_id ?? null,
    agent_run_id: of('done')?.agent_run_id ?? null,
    error: of('error') ?? null,
    json: response.body.trimStart().startsWith('{') ? JSON.parse(response.body) : null,
  }
}

function parseSse(body: string): Array<{ name: string; data: any }> {
  return body
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/)
      const name = /^event:\s*(.*)$/.exec(lines[0] ?? '')?.[1] ?? 'message'
      const payload = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')
      return { name, data: payload ? JSON.parse(payload) : null }
    })
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

test('Chat 先给讨论回复,再由"问题+回复"触发思考进入确认闸门', async () => {
  const turn = await sendChat(projectId, {
    content: '我们已经完成第一轮实验,结果基本符合预期,你怎么看?',
  })
  assert.equal(turn.status, 200)
  assert.match(turn.reply, /scripted 讨论回复/)
  assert.ok(turn.agent_run_id)
  sessionId = turn.session_id!

  // 对话流里只有问答,思考结果不混进消息
  const messages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${sessionId}/messages`,
  )
  assert.deepEqual(
    messages.json.items.map((item: { role: string }) => item.role),
    ['user', 'assistant'],
  )
  assert.equal(messages.json.items[1].content, turn.reply)

  // 思考由整段对话记录触发的 conversation Observation
  const observations = await api('GET', `/api/v1/projects/${projectId}/observations`)
  assert.equal(observations.json.items.length, 1)
  assert.equal(observations.json.items[0].type, 'conversation')
  assert.match(observations.json.items[0].content, /^我:.*\n智能体:/s)

  await drainWorker()

  const run = await api('GET', `/api/v1/projects/${projectId}/runs/${turn.agent_run_id}`)
  assert.equal(run.json.status, 'completed')

  // 右栏思考结果接口返回这次 Run 的判断和产出
  const insights = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${sessionId}/runs`,
  )
  assert.equal(insights.json.items.length, 1)
  const insight = insights.json.items[0]
  assert.equal(insight.status, 'completed')
  assert.match(insight.judgment, /第一轮实验/)
  assert.equal(insight.state_proposals.length, 1)
  assert.equal(insight.actions.length, 1)
  assert.equal(insight.events.length, 1)
  assert.equal(insight.recommendations.length, 1)
  assert.equal(insight.state_proposals[0].status, 'pending')
  assert.equal(insight.actions[0].status, 'proposed')
  assert.equal(insight.recommendations[0].status, 'pending')

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
})

test('没有新信息的讨论只给判断,不产出任何项目变更', async () => {
  const turn = await sendChat(projectId, { content: '你好呀,最近怎么样?' })
  assert.equal(turn.status, 200)
  await drainWorker()

  const insights = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${turn.session_id}/runs`,
  )
  assert.equal(insights.json.items.length, 1)
  const insight = insights.json.items[0]
  assert.equal(insight.status, 'completed')
  assert.match(insight.judgment, /没有带来需要记录的新信息/)
  assert.equal(insight.state_proposals.length, 0)
  assert.equal(insight.events.length, 0)
  assert.equal(insight.actions.length, 0)
  assert.equal(insight.recommendations.length, 0)
})

test('多个对话会话互相隔离,列表带预览与消息数', async () => {
  const sessionsBefore = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions?type=chat`,
  )
  const firstId = sessionId

  // 不带 session_id 发消息,创建第二个会话
  const second = await sendChat(projectId, {
    content: '新会话:第二轮实验的方案已经确定了。',
  })
  const secondId = second.session_id!
  assert.notEqual(secondId, firstId)
  await drainWorker()

  // 列表带预览与消息数,新会话排在最前
  const sessions = await api('GET', `/api/v1/projects/${projectId}/sessions?type=chat`)
  const ids = sessions.json.items.map((item: { id: string }) => item.id)
  assert.equal(ids[0], secondId)
  assert.ok(ids.includes(firstId))
  const secondItem = sessions.json.items[0]
  assert.equal(secondItem.preview, '新会话:第二轮实验的方案已经确定了。')
  assert.equal(secondItem.message_count, 2)

  // 两个会话的消息互不串
  const firstMessages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${firstId}/messages`,
  )
  assert.ok(
    firstMessages.json.items.every((item: { content: string }) =>
      !item.content.includes('新会话'),
    ),
  )
  const secondMessages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${secondId}/messages`,
  )
  assert.equal(secondMessages.json.items.length, 2)

  // 各自的思考结果只属于本会话
  const secondInsights = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${secondId}/runs`,
  )
  assert.ok(secondInsights.json.items.length >= 1)
  assert.ok(
    secondInsights.json.items.every((item: { judgment: string | null }) =>
      !String(item.judgment ?? '').includes('第一轮实验'),
    ),
  )
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
    async converse() {
      throw new Error('这个测试不使用对话')
    },
    async organize() {
      throw new Error('这个测试不使用整理')
    },
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

  await sendChat(projectId, { content: '通知测试:这轮实验也完成了。' })
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

test('通知可以只看某个 Project,已读操作也只影响这个 Project', async () => {
  const created = await api('POST', '/api/v1/projects', {
    name: '通知范围测试',
    objective: '验证通知按项目收窄。',
  })
  const otherProject = created.json.id as string
  await getDb().query(
    `INSERT INTO notifications (project_id, type, severity, title, content)
     VALUES ($1, 'risk', 'warning', '另一个项目的通知', '只该出现在它自己的项目里')`,
    [otherProject],
  )

  const other = await api('GET', `/api/v1/notifications/unread-count?project_id=${otherProject}`)
  assert.equal(other.json.count, 1)

  const scoped = await api('GET', `/api/v1/notifications?project_id=${otherProject}`)
  assert.equal(scoped.json.items.length, 1)
  assert.equal(scoped.json.items[0].project_id, otherProject)
  assert.equal(scoped.json.unread_count, 1)

  // 自己没参与的项目看不到任何通知
  const stranger = await api(
    'POST',
    '/api/v1/projects',
    { name: '别人的项目', objective: '验证通知不跨人可见。' },
    { 'x-user-id': secondUserId },
  )
  const denied = await api('GET', `/api/v1/notifications?project_id=${stranger.json.id}`)
  assert.equal(denied.json.items.length, 0)
  assert.equal(denied.json.unread_count, 0)

  // 在某个项目里点「全部已读」,别的项目不受影响
  const mineBefore = await api('GET', `/api/v1/notifications/unread-count?project_id=${projectId}`)
  await api('POST', '/api/v1/notifications/read-all', { project_id: otherProject })
  const otherAfter = await api('GET', `/api/v1/notifications/unread-count?project_id=${otherProject}`)
  assert.equal(otherAfter.json.count, 0)
  const mineAfter = await api('GET', `/api/v1/notifications/unread-count?project_id=${projectId}`)
  assert.equal(mineAfter.json.count, mineBefore.json.count)
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
  await sendChat(projectId, { content: '来源追踪:第三轮实验完成了。' })
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

// ---------- 资料(kind=document):文档上传、解析、对话与 AI 整理 ----------

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures')

interface UploadFile {
  field: string
  filename: string
  content: Buffer
  mime: string
}

function multipartBody(files: UploadFile[]): { body: Buffer; contentType: string } {
  const boundary = '----loop-test-boundary'
  const chunks: Buffer[] = []
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\ncontent-type: ${file.mime}\r\n\r\n`,
      ),
    )
    chunks.push(file.content)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function uploadFiles(
  actionId: string,
  files: UploadFile[],
  userId: string = devUserId,
): Promise<{ status: number; json: any }> {
  const form = multipartBody(files)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/actions/${actionId}/documents/upload`,
    headers: { 'x-user-id': userId, 'content-type': form.contentType },
    payload: form.body,
  })
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null }
}

let documentActionId = ''

test('资料行动可以上传文档,解析文本入库并取回文件字节', async () => {
  const created = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '整理实验报告资料',
    kind: 'document',
  })
  assert.equal(created.json.kind, 'document')
  documentActionId = created.json.id

  const txt = fs.readFileSync(path.join(fixturesDir, 'sample.txt'))
  const docx = fs.readFileSync(path.join(fixturesDir, 'sample.docx'))
  const upload = await uploadFiles(documentActionId, [
    { field: 'files', filename: 'sample.txt', content: txt, mime: 'text/plain' },
    {
      field: 'files',
      filename: '实验记录.docx',
      content: docx,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  ])
  assert.equal(upload.status, 201)
  assert.equal(upload.json.items.length, 2)
  assert.ok(upload.json.items.every((doc: { parse_status: string }) => doc.parse_status === 'ok'))

  const detail = await api('GET', `/api/v1/projects/${projectId}/actions/${documentActionId}`)
  assert.equal(detail.json.documents.length, 2)
  const txtDoc = detail.json.documents.find((doc: { name: string }) => doc.name === 'sample.txt')
  assert.ok(txtDoc)
  assert.ok(txtDoc.extracted_chars > 0)

  // 不支持的格式标记为 unsupported,并可以删除
  const png = fs.readFileSync(path.join(fixturesDir, 'sample.png'))
  const pngUpload = await uploadFiles(documentActionId, [
    { field: 'files', filename: 'photo.png', content: png, mime: 'image/png' },
  ])
  assert.equal(pngUpload.json.items[0].parse_status, 'unsupported')
  // DELETE 不带 content-type,空 body 配 application/json 会被 Fastify 拒绝
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/v1/projects/${projectId}/actions/${documentActionId}/documents/${pngUpload.json.items[0].id}`,
    headers: { 'x-user-id': devUserId },
  })
  assert.equal(removed.statusCode, 204)

  // 上传的文件字节可以通过接口原样取回
  const file = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectId}/actions/${documentActionId}/documents/${txtDoc.id}/file`,
    headers: { 'x-user-id': devUserId },
  })
  assert.equal(file.statusCode, 200)
  assert.ok(file.rawPayload.equals(txt))
})

test('URL 导入只存元数据并解析文本,没有本地文件', async () => {
  const docx = fs.readFileSync(path.join(fixturesDir, 'sample.docx'))
  const server = http.createServer((req, res) => {
    if (req.url === '/report.docx') {
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      res.end(docx)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  try {
    const imported = await api(
      'POST',
      `/api/v1/projects/${projectId}/actions/${documentActionId}/documents/import-url`,
      { url: `http://127.0.0.1:${port}/report.docx` },
    )
    assert.equal(imported.status, 201)
    assert.equal(imported.json.source, 'url')
    assert.equal(imported.json.parse_status, 'ok')
    assert.equal(imported.json.name, 'report.docx')

    // URL 来源不保存字节,文件接口返回 404
    const file = await api(
      'GET',
      `/api/v1/projects/${projectId}/actions/${documentActionId}/documents/${imported.json.id}/file`,
    )
    assert.equal(file.status, 404)
  } finally {
    server.close()
  }
})

test('AI 整理基于文档文本生成草稿,空资料行动会被拒绝', async () => {
  const organize = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${documentActionId}/organize`,
    { instruction: '重点看第二轮数据' },
  )
  assert.equal(organize.status, 200)
  assert.ok(organize.json.summary)
  assert.ok(organize.json.key_points.length >= 1)
  assert.match(`${organize.json.key_points.join(';')}${organize.json.content}`, /sample\.txt/)

  // 没有可解析文档的资料行动无法整理
  const empty = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '还没有资料的整理行动',
    kind: 'document',
  })
  const emptyOrganize = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${empty.json.id}/organize`,
    {},
  )
  assert.equal(emptyOrganize.status, 422)

  // 非资料行动不能整理
  const task = await api('POST', `/api/v1/projects/${projectId}/actions`, {
    title: '普通任务',
    kind: 'task',
  })
  const taskOrganize = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${task.json.id}/organize`,
    {},
  )
  assert.equal(taskOrganize.status, 422)
})

test('带资料上下文的对话引用文档内容,消息记录资料来源', async () => {
  const turn = await sendChat(projectId, {
    content: '这份资料说明了什么?',
    document_id: documentActionId,
  })
  assert.equal(turn.status, 200)
  assert.match(turn.reply, /sample\.txt/)

  const messages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${turn.session_id}/messages`,
  )
  assert.equal(messages.json.items[0].metadata.document_id, documentActionId)
})

test('完成资料行动时 Observation 带上要点和文件名', async () => {
  const completed = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${documentActionId}/complete`,
    {
      result: {
        summary: '资料整理完成',
        output: { key_points: ['第二轮数据已回收,结论待确认'], content: '详见文档正文' },
      },
    },
  )
  assert.equal(completed.json.status, 'completed')

  const observation = await api(
    'GET',
    `/api/v1/projects/${projectId}/observations/${completed.json.observation_id}`,
  )
  assert.match(observation.json.content, /要点:第二轮数据已回收,结论待确认/)
  assert.match(observation.json.content, /文件:sample\.txt、实验记录\.docx、report\.docx/)
})

test('行动结束后不能再修改文档,非成员没有上传权限', async () => {
  const txt = fs.readFileSync(path.join(fixturesDir, 'sample.txt'))
  const upload = await uploadFiles(documentActionId, [
    { field: 'files', filename: 'late.txt', content: txt, mime: 'text/plain' },
  ])
  assert.equal(upload.status, 409)

  const outsiderUpload = await uploadFiles(
    documentActionId,
    [{ field: 'files', filename: 'late.txt', content: txt, mime: 'text/plain' }],
    secondUserId,
  )
  assert.equal(outsiderUpload.status, 403)
})

// ---------- 对话的流式返回 ----------

test('对话按 SSE 返回:先是会话,再是增量,最后是收尾', async () => {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/chat`,
    headers: { 'content-type': 'application/json', 'x-user-id': devUserId },
    payload: JSON.stringify({ content: '流式对话:第四轮实验已经完成。' }),
  })

  assert.equal(response.statusCode, 200)
  assert.match(String(response.headers['content-type']), /text\/event-stream/)

  const events = parseSse(response.body)
  const names = events.map((item) => item.name)
  assert.equal(names[0], 'session', '会话必须最先下发,前端靠它确定消息落在哪一段对话')
  assert.equal(names.at(-1), 'done')
  assert.deepEqual(
    names.filter((name) => name !== 'delta'),
    ['session', 'reasoning', 'done'],
    '推理过程只发一次,排在正文之前',
  )
  const firstDelta = names.indexOf('delta')
  assert.ok(
    names.indexOf('reasoning') < firstDelta,
    '推理过程要先于正文到达,前端才能把它显示在回答上方',
  )
  const deltas = events.filter((item) => item.name === 'delta')
  assert.ok(deltas.length > 1, `回复应该分多段下发,实际只有 ${deltas.length} 段`)

  const reasoning = events
    .filter((item) => item.name === 'reasoning')
    .map((item) => item.data.text as string)
    .join('')
  assert.match(reasoning, /scripted 推理/)

  const streamedSessionId = events[0]!.data.session_id
  const done = events.at(-1)!.data
  assert.equal(done.session_id, streamedSessionId)
  assert.ok(done.observation_id)
  assert.ok(done.agent_run_id)
  assert.equal(done.replayed, false)

  // 增量拼起来就是落库的完整回复,推理过程单独存在 metadata 里
  const reply = deltas.map((item) => item.data.text as string).join('')
  const messages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${streamedSessionId}/messages`,
  )
  assert.deepEqual(
    messages.json.items.map((item: { role: string }) => item.role),
    ['user', 'assistant'],
  )
  assert.equal(messages.json.items[1].content, reply)
  assert.equal(messages.json.items[1].metadata.reasoning, reasoning)

  // 推理过程只用于展示:不进入交给思考的问答记录
  const observation = await api(
    'GET',
    `/api/v1/projects/${projectId}/observations/${done.observation_id}`,
  )
  assert.doesNotMatch(observation.json.content, /scripted 推理/)
})

test('对话说到一半失败:保留半截回复,但不触发思考', async () => {
  const before = await runList(projectId)
  const question = '模拟中断:第五轮实验的情况如何?'
  const turn = await sendChat(projectId, { content: question })

  assert.equal(turn.status, 200)
  assert.ok(turn.error, '流里应该有终止对话的 error 事件')
  assert.equal(turn.error!.code, 'ENGINE_UNAVAILABLE')
  assert.equal(turn.reply, '(scripted 半截回复)先说结论:')
  assert.equal(turn.reasoning, '(scripted 推理)先看项目状态,')
  assert.equal(turn.agent_run_id, null)

  // 问题和半截回复都留在对话里,回复标记为中断,已经发出的推理过程一起保存
  const messages = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${turn.session_id}/messages`,
  )
  assert.deepEqual(
    messages.json.items.map((item: { role: string }) => item.role),
    ['user', 'assistant'],
  )
  assert.equal(messages.json.items[0].content, question)
  assert.equal(messages.json.items[1].content, turn.reply)
  assert.equal(messages.json.items[1].metadata.interrupted, true)
  assert.equal(messages.json.items[1].metadata.reasoning, turn.reasoning)

  // 这一轮不产生 Observation,也就没有新的思考
  assert.equal((await runList(projectId)).length, before.length)

  // 用户重发:中断的半截回复不进入交给思考的问答记录
  const retry = await sendChat(projectId, {
    content: '重新问:第五轮实验结果已经拿到了。',
    session_id: turn.session_id,
  })
  assert.equal(retry.error, null)
  assert.ok(retry.agent_run_id)
  await drainWorker()

  const observation = await api(
    'GET',
    `/api/v1/projects/${projectId}/observations/${retry.observation_id}`,
  )
  assert.match(observation.json.content, /模拟中断/)
  assert.doesNotMatch(observation.json.content, /scripted 半截回复/)
})

test('思考结果里的产出处理过之后仍然保留,只是换成处理结果', async () => {
  const turn = await sendChat(projectId, { content: '保留测试:这轮实验出了问题,数据也不对。' })
  await drainWorker()

  const before = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${turn.session_id}/runs`,
  )
  const insight = before.json.items[0]
  assert.equal(insight.state_proposals.length, 1)
  assert.equal(insight.actions.length, 1)
  assert.equal(insight.events.length, 1)
  assert.equal(insight.recommendations.length, 1)
  assert.equal(insight.state_proposals[0].status, 'pending')
  assert.equal(insight.actions[0].status, 'proposed')
  assert.equal(insight.recommendations[0].status, 'pending')

  await api(
    'POST',
    `/api/v1/projects/${projectId}/state/proposals/${insight.state_proposals[0].id}/apply`,
    {},
  )
  await api('POST', `/api/v1/projects/${projectId}/actions/${insight.actions[0].id}/confirm`, {})
  await api(
    'POST',
    `/api/v1/projects/${projectId}/recommendations/${insight.recommendations[0].id}/reject`,
    {},
  )

  // 处理完不是从这一栏消失,而是换成状态:要能回看整轮思考产出了什么、当时怎么处理的
  const after = await api(
    'GET',
    `/api/v1/projects/${projectId}/sessions/${turn.session_id}/runs`,
  )
  const resolved = after.json.items[0]
  assert.equal(resolved.state_proposals.length, 1)
  assert.equal(resolved.state_proposals[0].status, 'applied')
  assert.equal(resolved.actions.length, 1)
  assert.equal(resolved.actions[0].status, 'pending')
  assert.equal(resolved.recommendations.length, 1)
  assert.equal(resolved.recommendations[0].status, 'rejected')
})
