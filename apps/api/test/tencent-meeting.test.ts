import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'

const dataDir = path.resolve(import.meta.dirname, '../.data/tencent-meeting-test-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.PGDATA_DIR = dataDir
delete process.env.DATABASE_URL
process.env.WORKER_ENABLED = 'false'
process.env.TENCENT_MEETING_TOKEN_ENCRYPTION_KEY = '11'.repeat(32)
process.env.TENCENT_MEETING_MCP_URL = 'https://mcp.test.tencent.local'

const { encryptSecret, decryptSecret } = await import('../src/auth/security.js')
const { syncTencentMeeting } = await import('../src/integrations/tencent-meeting.js')
const { buildServer } = await import('../src/http/server.js')
const { getDb, closeDb } = await import('../src/db/client.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { ensureDevUser } = await import('../src/db/seed.js')

const app = buildServer()
let userId = ''
let projectId = ''
let meetingActionId = ''
let taskActionId = ''

async function api(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await app.inject({
    method: method as 'GET',
    url,
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null }
}

before(async () => {
  await runMigrations({ quiet: true })
  await app.ready()
  const user = await ensureDevUser()
  userId = user.id

  const db = getDb()
  const project = await db.query<{ id: string }>(
    `INSERT INTO projects (name, objective, created_by) VALUES ('腾讯会议测试', '验证会议同步', $1) RETURNING id`,
    [userId],
  )
  projectId = project.rows[0]!.id
  await db.query('INSERT INTO project_users (project_id, user_id, role) VALUES ($1, $2, $3)', [
    projectId,
    userId,
    'owner',
  ])
  const actions = await db.query<{ id: string; kind: string }>(
    `INSERT INTO actions (project_id, title, executor_type, kind)
     VALUES ($1, '同步腾讯会议', 'human', 'meeting'), ($1, '普通任务', 'human', 'task')
     RETURNING id, kind`,
    [projectId],
  )
  meetingActionId = actions.rows.find((row) => row.kind === 'meeting')!.id
  taskActionId = actions.rows.find((row) => row.kind === 'task')!.id
})

after(async () => {
  await app.close()
  await closeDb()
})

test('腾讯会议 Token 使用 AES-256-GCM 加密且可恢复', () => {
  const encrypted = encryptSecret('secret-token')
  assert.notEqual(encrypted, 'secret-token')
  assert.equal(decryptSecret(encrypted), 'secret-token')
})

test('Provider 会把 MCP 返回的会议内容整理成会议同步结果', async () => {
  const calls: string[] = []
  const result = await syncTencentMeeting('token', '123456789', {
    async callTool(name) {
      calls.push(name)
      if (name === 'get_meeting_by_code') {
        return { meeting: { meeting_id: 'meeting-1', topic: '产品评审', start_time: 1_760_000_000 } }
      }
      if (name === 'get_meeting_participants') return { participants: [{ name: '张三' }, { display_name: '李四' }] }
      if (name === 'get_records_list') return { records: [{ record_file_id: 'record-1' }] }
      if (name === 'get_smart_minutes') {
        return { meeting_minute: { minute: '本次会议确定了发布范围。', todo: '- 补充测试报告' } }
      }
      if (name === 'get_transcripts_paragraphs') {
        return { segments: [{ speaker: '张三', start_time: 1_760_000_000, text: '我们开始评审。' }] }
      }
      throw new Error(`unexpected tool:${name}`)
    },
  })

  assert.equal(result.meetingId, 'meeting-1')
  assert.deepEqual(result.participants, ['张三', '李四'])
  assert.equal(result.summary, '本次会议确定了发布范围。')
  assert.equal(result.todo, '- 补充测试报告')
  assert.equal(result.transcript, '张三: 我们开始评审。')
  assert.deepEqual(calls, [
    'get_meeting_by_code',
    'get_meeting_participants',
    'get_records_list',
    'get_smart_minutes',
    'get_transcripts_paragraphs',
  ])
})

test('会议同步接口只允许会议 Action,并对同一 Action 幂等更新', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name?: string } }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })

    const tool = body.params?.name
    const structuredContent = tool === 'get_meeting_by_code'
      ? { meeting: { meeting_id: 'meeting-1', topic: '产品评审' } }
      : tool === 'get_meeting_participants'
        ? { participants: [{ name: '张三' }] }
        : tool === 'get_records_list'
          ? { records: [{ record_file_id: 'record-1' }] }
          : tool === 'get_smart_minutes'
            ? { meeting_minute: { minute: '会议摘要', todo: '- 完成跟进' } }
            : { segments: [{ speaker: '张三', text: '会议内容' }] }

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { structuredContent },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const configured = await api('PUT', '/api/v1/me/integrations/tencent-meeting', { token: 'secret-token' })
    assert.equal(configured.status, 200)
    const stored = await getDb().query<{ encrypted_token: string }>(
      'SELECT encrypted_token FROM user_integrations WHERE user_id = $1',
      [userId],
    )
    assert.equal(stored.rows.length, 1)
    assert.doesNotMatch(stored.rows[0]!.encrypted_token, /secret-token/)

    const first = await api(
      'POST',
      `/api/v1/projects/${projectId}/actions/${meetingActionId}/meeting-sync`,
      { meeting_code: '123456789' },
    )
    assert.equal(first.status, 200)
    assert.equal(first.json.meeting_sync.summary, '会议摘要')
    assert.deepEqual(first.json.meeting_sync.participants, ['张三'])

    const second = await api(
      'POST',
      `/api/v1/projects/${projectId}/actions/${meetingActionId}/meeting-sync`,
      { meeting_code: '123456789' },
    )
    assert.equal(second.status, 200)
    const rows = await getDb().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM action_meeting_syncs WHERE action_id = $1',
      [meetingActionId],
    )
    assert.equal(rows.rows[0]!.count, '1')

    const task = await api(
      'POST',
      `/api/v1/projects/${projectId}/actions/${taskActionId}/meeting-sync`,
      { meeting_code: '123456789' },
    )
    assert.equal(task.status, 409)
  } finally {
    globalThis.fetch = originalFetch
  }
})
