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
process.env.TENCENT_MEETING_MCP_URL = 'https://mcp.test.tencent.local/mcp/wemeet-open/v1'

const { encryptSecret, decryptSecret } = await import('../src/auth/security.js')
const {
  TencentMeetingClient,
  parseMeetingDetail,
  parseMeetingList,
  parseMinutes,
  parseTranscript,
} = await import('../src/integrations/tencent-meeting.js')
const { buildServer } = await import('../src/http/server.js')
const { getDb, closeDb } = await import('../src/db/client.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { ensureDevUser } = await import('../src/db/seed.js')

const app = buildServer()
const originalFetch = globalThis.fetch

let userId = ''
let projectId = ''
let meetingActionId = ''
let fallbackActionId = ''
let taskActionId = ''

async function api(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await app.inject({
    method: method as 'GET',
    url,
    headers: {
      'x-user-id': userId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null }
}

function mcpResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** 模拟真实返回:业务结果包在 data.status_code / data.body 里 */
function mcpSuccess(body: unknown): Response {
  return mcpResponse({ data: { status_code: 200, body: JSON.stringify(body) } })
}

function mcpError(message: string): Response {
  return mcpResponse({
    data: {
      status_code: 500,
      body: JSON.stringify({ error: `type:business, code:-1, msg:${message}` }),
    },
  })
}

function stubMcp(handler: (tool: string, args: Record<string, unknown>) => Response): void {
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      params?: { name?: string; arguments?: Record<string, unknown> }
    }
    return handler(request.params?.name ?? '', request.params?.arguments ?? {})
  }
}

function meetingContentStub(): Response {
  return mcpSuccess({
    meeting_info_list: [
      {
        meeting_id: 'meeting-1',
        meeting_code: '987654321',
        subject: '产品评审',
        start_time: '2026-10-17T10:00:00+08:00',
        end_time: '2026-10-17T11:00:00+08:00',
      },
    ],
  })
}

before(async () => {
  await runMigrations({ quiet: true })
  await app.ready()
  const user = await ensureDevUser()
  userId = user.id

  const db = getDb()
  const project = await db.query<{ id: string }>(
    `INSERT INTO projects (name, objective, created_by)
     VALUES ('腾讯会议测试', '验证会议内容导入', $1) RETURNING id`,
    [userId],
  )
  projectId = project.rows[0]!.id
  await db.query('INSERT INTO project_users (project_id, user_id, role) VALUES ($1, $2, $3)', [
    projectId,
    userId,
    'owner',
  ])
  await db.query('INSERT INTO agent_states (project_id) VALUES ($1)', [projectId])
  const actions = await db.query<{ id: string; kind: string }>(
    `INSERT INTO actions (project_id, title, executor_type, kind)
     VALUES ($1, '产品评审', 'human', 'meeting'), ($1, '普通任务', 'human', 'task'), ($1, '兜底测试会议', 'human', 'meeting')
     RETURNING id, kind`,
    [projectId],
  )
  const meetingActions = actions.rows.filter((row) => row.kind === 'meeting')
  meetingActionId = meetingActions[0]!.id
  fallbackActionId = meetingActions[1]!.id
  taskActionId = actions.rows.find((row) => row.kind === 'task')!.id
})

after(async () => {
  globalThis.fetch = originalFetch
  await app.close()
  await closeDb()
})

test('腾讯会议 Token 使用 AES-256-GCM 加密且可恢复', () => {
  const encrypted = encryptSecret('secret-token-3f2a')
  assert.notEqual(encrypted, 'secret-token-3f2a')
  assert.equal(decryptSecret(encrypted), 'secret-token-3f2a')
})

test('会议列表、纪要和逐字稿能从腾讯会议的返回结构中解析出来', () => {
  const list = parseMeetingList({
    meeting_info_list: [
      {
        meeting_id: 'meeting-1',
        meeting_code: '987654321',
        subject: '产品评审',
        start_time: '2026-10-17T10:00:00+08:00',
        end_time: '2026-10-17T11:00:00+08:00',
      },
    ],
    has_more: true,
    next_page_token: 'next',
  })
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0]!.title, '产品评审')
  assert.equal(list.hasMore, true)
  assert.equal(list.nextPageToken, 'next')

  const minutes = parseMinutes({
    overview: '讨论了发布范围',
    summary_points: [{ content: '十月中旬发布' }],
    todos: [{ content: '补充测试报告' }, '确认上线时间'],
  })
  assert.match(minutes.content ?? '', /讨论了发布范围/)
  assert.match(minutes.content ?? '', /十月中旬发布/)
  assert.equal(minutes.summary, '讨论了发布范围')
  assert.deepEqual(minutes.todos, ['补充测试报告', '确认上线时间'])

  const transcript = parseTranscript({
    minutes: {
      paragraphs: [
        {
          pid: '1',
          start_time: 120000,
          end_time: 130000,
          speaker_info: { username: '张三' },
          sentences: [{ words: [{ text: '我们开始' }, { text: '评审。' }] }],
        },
      ],
    },
  })
  assert.equal(transcript?.text, '张三：我们开始评审。')
  assert.equal(transcript?.segments[0]?.startMs, 120000)
})

test('会议详情从 meeting_info_list 解析,并带出内置录制列表', () => {
  const detail = parseMeetingDetail({
    meeting_info_list: [
      {
        meeting_id: 'meeting-1',
        meeting_code: '987654321',
        current_sub_meeting_id: 'sub-1',
        subject: 'Team1周期会议',
        start_time: '2026-10-16T21:00:00+08:00',
        end_time: '2026-10-16T21:30:00+08:00',
        records: [
          {
            meeting_record_id: 'record-1',
            record_file_id: 'file-1',
            media_start_time: '2026-10-16T21:05:27+08:00',
            permission_status: 'can_view',
          },
        ],
      },
    ],
  })

  assert.ok(detail)
  assert.equal(detail.meetingId, 'meeting-1')
  assert.equal(detail.title, 'Team1周期会议')
  assert.equal(detail.subMeetingId, 'sub-1')
  assert.equal(detail.records.length, 1)
  assert.equal(detail.records[0]?.recordFileId, 'file-1')
  assert.equal(detail.records[0]?.mediaStartTime, '2026-10-16T13:05:27.000Z')
})

test('智能纪要和逐字稿的真实返回结构可以解析', () => {
  const minutes = parseMinutes({
    meeting_minute: {
      minute: '会议主题：产品评审\n\n会议摘要：本次会议确定了发布范围。',
      todo: '',
      todos: [{ content: '- 补充测试报告' }, { content: '确认上线时间' }],
    },
  })
  assert.match(minutes.content ?? '', /产品评审/)
  assert.equal(minutes.summary, '本次会议确定了发布范围。')
  assert.deepEqual(minutes.todos, ['补充测试报告', '确认上线时间'])

  const withoutSummary = parseMinutes({
    meeting_minute: { minute: '会议主题：产品评审', todos: [] },
  })
  assert.equal(withoutSummary.summary, null)

  const transcript = parseTranscript({
    minutes: {
      paragraphs: [
        {
          pid: '0',
          start_time: 96421,
          end_time: 97861,
          speaker: { user_name: '刘征' },
          sentences: [{ words: [{ text: '大家好。' }] }],
        },
      ],
    },
  })
  assert.equal(transcript?.text, '刘征：大家好。')
  assert.equal(transcript?.segments[0]?.speaker, '刘征')
})

test('MCP 业务错误会映射为可识别的 ApiError', async () => {
  const client = new TencentMeetingClient({
    token: 'fake',
    fetchImpl: async () => mcpError('token not found'),
  })
  await assert.rejects(
    () => client.listEndedMeetings({ from: 'a', to: 'b' }),
    (error: unknown) =>
      (error as { code?: string }).code === 'INTEGRATION_AUTH_FAILED',
  )
})

test('无效 Token 不会落库,有效 Token 只保存密文和掩码', async () => {
  stubMcp((tool) =>
    tool === 'get_user_ended_meetings' ? mcpError('token not found') : mcpError(`unexpected:${tool}`),
  )
  const rejected = await api('PUT', '/api/v1/me/integrations/tencent-meeting', {
    token: 'bad-token',
  })
  assert.equal(rejected.status, 401)
  assert.equal(rejected.json.error.code, 'INTEGRATION_AUTH_FAILED')

  const beforeBind = await api('GET', '/api/v1/me/integrations/tencent-meeting')
  assert.equal(beforeBind.json.configured, false)

  stubMcp((tool) =>
    tool === 'get_user_ended_meetings'
      ? mcpSuccess({ meeting_info_list: [] })
      : mcpError(`unexpected:${tool}`),
  )
  const bound = await api('PUT', '/api/v1/me/integrations/tencent-meeting', {
    token: 'secret-token-3f2a',
  })
  assert.equal(bound.status, 200)
  assert.equal(bound.json.configured, true)
  assert.equal(bound.json.masked_token, '••••3f2a')

  const stored = await getDb().query<{ encrypted_token: string; token_hint: string }>(
    'SELECT encrypted_token, token_hint FROM user_integrations WHERE user_id = $1',
    [userId],
  )
  assert.equal(stored.rows.length, 1)
  assert.doesNotMatch(stored.rows[0]!.encrypted_token, /secret-token-3f2a/)
  assert.equal(stored.rows[0]!.token_hint, '••••3f2a')

  const status = await api('GET', '/api/v1/me/integrations/tencent-meeting')
  assert.equal(status.json.configured, true)
  assert.equal(status.json.masked_token, '••••3f2a')
})

test('会议列表接口返回归一化后的已结束会议', async () => {
  stubMcp((tool) =>
    tool === 'get_user_ended_meetings'
      ? mcpSuccess({
          meeting_info_list: [
            {
              meeting_id: 'meeting-1',
              meeting_code: '987654321',
              subject: '产品评审',
              start_time: '2026-10-17T10:00:00+08:00',
              end_time: '2026-10-17T11:00:00+08:00',
            },
          ],
          has_more: false,
        })
      : mcpError(`unexpected:${tool}`),
  )
  const from = encodeURIComponent('2026-10-11T00:00:00+08:00')
  const to = encodeURIComponent('2026-10-18T23:59:59+08:00')
  const result = await api(
    'GET',
    `/api/v1/me/integrations/tencent-meeting/meetings?from=${from}&to=${to}`,
  )
  assert.equal(result.status, 200)
  assert.equal(result.json.items.length, 1)
  assert.equal(result.json.items[0].meeting_id, 'meeting-1')
  assert.equal(result.json.items[0].title, '产品评审')
  assert.equal(result.json.has_more, false)
})

test('会议导入保存快照,重复导入只更新同一条记录', async () => {
  let transcriptsCalls = 0
  stubMcp((tool) => {
    if (tool === 'get_meeting') return meetingContentStub()
    if (tool === 'get_meeting_participants') {
      return mcpSuccess({ participants: [{ name: '张三' }, { display_name: '李四' }] })
    }
    if (tool === 'get_minutes') {
      return mcpSuccess({
        overview: '本次会议确定了发布范围。',
        summary_points: [{ content: '十月中旬发布' }],
        todos: [{ content: '补充测试报告' }],
      })
    }
    if (tool === 'get_records_list') {
      return mcpSuccess({
        record_meetings: [{ state: 3, record_files: [{ record_file_id: 'record-1' }] }],
      })
    }
    if (tool === 'get_transcripts_paragraphs') {
      return mcpSuccess({ pids: [{ pid: '1' }], audio_detect: 1 })
    }
    if (tool === 'get_transcripts_details') {
      transcriptsCalls += 1
      return mcpSuccess({
        minutes: {
          paragraphs: [
            {
              pid: '1',
              start_time: 120000,
              end_time: 130000,
              speaker_info: { username: '张三' },
              sentences: [{ words: [{ text: '我们开始评审。' }] }],
            },
          ],
        },
      })
    }
    return mcpError(`unexpected:${tool}`)
  })

  const imported = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(imported.status, 200)
  const snapshot = imported.json.meeting_import
  assert.equal(snapshot.meeting_title, '产品评审')
  assert.deepEqual(snapshot.participants, ['张三', '李四'])
  assert.equal(snapshot.summary, '本次会议确定了发布范围。')
  assert.match(snapshot.minutes, /本次会议确定了发布范围/)
  assert.match(snapshot.minutes, /补充测试报告/)
  assert.deepEqual(snapshot.todos, ['补充测试报告'])
  assert.match(snapshot.transcript, /我们开始评审/)
  assert.equal(snapshot.content_source, 'minutes')
  assert.equal(transcriptsCalls, 1)

  const again = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(again.status, 200)
  const rows = await getDb().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM action_meeting_imports WHERE action_id = $1',
    [meetingActionId],
  )
  assert.equal(rows.rows[0]!.count, '1')
})

test('参会人接口没权限时,从纪要发言人一行兜底', async () => {
  stubMcp((tool) => {
    if (tool === 'get_meeting') return meetingContentStub()
    if (tool === 'get_meeting_participants') return mcpError('无权限操作')
    if (tool === 'get_minutes') {
      return mcpSuccess({
        meeting_minute: {
          minute: '会议主题：产品评审\n\n发言人：张三、李四、王五等7人\n\n会议摘要：确定了发布范围。',
          todos: [],
        },
      })
    }
    if (tool === 'get_records_list') return mcpSuccess({ record_meetings: [] })
    return mcpError(`unexpected:${tool}`)
  })

  const imported = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${fallbackActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(imported.status, 200)
  assert.deepEqual(imported.json.meeting_import.participants, ['张三', '李四', '王五'])
})

test('参会人和纪要发言人都没有时,用逐字稿的发言人兜底', async () => {
  stubMcp((tool) => {
    if (tool === 'get_meeting') return meetingContentStub()
    if (tool === 'get_meeting_participants') return mcpError('无权限操作')
    if (tool === 'get_minutes') return mcpSuccess({ minutes: [], has_more: false })
    if (tool === 'get_records_list') {
      return mcpSuccess({
        record_meetings: [{ state: 3, record_files: [{ record_file_id: 'record-2' }] }],
      })
    }
    if (tool === 'get_smart_minutes') {
      return mcpSuccess({
        meeting_minute: { minute: '会议主题：产品评审', todos: [] },
      })
    }
    if (tool === 'get_transcripts_paragraphs') return mcpSuccess({ pids: [{ pid: '1' }] })
    if (tool === 'get_transcripts_details') {
      return mcpSuccess({
        minutes: {
          paragraphs: [
            {
              pid: '1',
              start_time: 1000,
              end_time: 2000,
              speaker: { user_name: '张三' },
              sentences: [{ words: [{ text: '大家好。' }] }],
            },
            {
              pid: '2',
              start_time: 3000,
              end_time: 4000,
              speaker: { user_name: '李四' },
              sentences: [{ words: [{ text: '继续。' }] }],
            },
            {
              pid: '3',
              start_time: 5000,
              end_time: 6000,
              speaker: { user_name: '张三' },
              sentences: [{ words: [{ text: '好的。' }] }],
            },
          ],
        },
      })
    }
    return mcpError(`unexpected:${tool}`)
  })

  const imported = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${fallbackActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(imported.status, 200)
  assert.deepEqual(imported.json.meeting_import.participants, ['张三', '李四'])
})

test('非会议 Action 不能导入,详情接口返回导入快照', async () => {
  const task = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${taskActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(task.status, 422)
  assert.equal(task.json.error.code, 'ACTION_KIND_MISMATCH')

  const detail = await api(
    'GET',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}`,
  )
  assert.equal(detail.status, 200)
  assert.equal(detail.json.meeting_import.meeting_title, '产品评审')
  assert.match(detail.json.meeting_import.transcript, /我们开始评审/)
})

test('完成会议 Action 后 Observation 有纪要和待办,但没有逐字稿', async () => {
  const completed = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}/complete`,
    {
      result: {
        summary: '产品评审完成',
        output: {
          participants: ['张三', '李四'],
          notes: '本次会议确定了发布范围。',
          decisions: ['十月中旬发布'],
          action_items: ['补充测试报告'],
        },
      },
    },
  )
  assert.equal(completed.status, 200, JSON.stringify(completed.json))

  const observation = await getDb().query<{ content: string }>(
    'SELECT content FROM observations WHERE id = $1',
    [completed.json.observation_id],
  )
  const content = observation.rows[0]!.content
  assert.match(content, /参与人:张三、李四/)
  assert.match(content, /纪要:本次会议确定了发布范围/)
  assert.match(content, /决定:十月中旬发布/)
  assert.match(content, /后续行动:补充测试报告/)
  assert.doesNotMatch(content, /我们开始评审/)

  const afterComplete = await api(
    'POST',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}/meeting-import`,
    { meeting_id: 'meeting-1' },
  )
  assert.equal(afterComplete.status, 409)
  assert.equal(afterComplete.json.error.code, 'ACTION_INVALID_STATE')

  const detail = await api(
    'GET',
    `/api/v1/projects/${projectId}/actions/${meetingActionId}`,
  )
  assert.match(detail.json.meeting_import.transcript, /我们开始评审/)
})

test('解除绑定后导入接口提示先绑定账号', async () => {
  const removed = await api('DELETE', '/api/v1/me/integrations/tencent-meeting')
  assert.equal(removed.status, 200)
  assert.equal(removed.json.configured, false)

  const list = await api('GET', '/api/v1/me/integrations/tencent-meeting/meetings')
  assert.equal(list.status, 422)
  assert.equal(list.json.error.code, 'INTEGRATION_NOT_CONFIGURED')
})
