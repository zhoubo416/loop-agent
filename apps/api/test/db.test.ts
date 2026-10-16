import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'

// 先定好测试库的位置再加载 db 模块:config 在导入时就会读 PGDATA_DIR 和 DATABASE_URL,
// 用静态 import 会在设置之前先加载,测试就跑到 .env 里的正式库上去了
const dataDir = path.resolve(import.meta.dirname, '../.data/test-db-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.PGDATA_DIR = dataDir
delete process.env.DATABASE_URL

const { getDb, closeDb, isReadOnlyStatement, isUniqueViolation } = await import(
  '../src/db/client.js'
)
const { runMigrations } = await import('../src/db/migrate.js')
const { addMessage, createSession } = await import('../src/modules/sessions.js')

test('只有读语句允许自动重试', () => {
  assert.equal(isReadOnlyStatement('SELECT * FROM projects'), true)
  assert.equal(isReadOnlyStatement('\n  select id from sessions'), true)

  // 写语句、认不出来的语句都不重试:重试可能把同一条写再做一遍
  for (const sql of [
    `INSERT INTO session_messages (session_id, seq) VALUES ($1, $2)`,
    `UPDATE projects SET status = 'active'`,
    `DELETE FROM idempotency_keys WHERE scope = $1`,
    `WITH ranked AS (SELECT 1) UPDATE session_messages SET seq = 1`,
    `INSERT INTO observations SELECT * FROM events`,
  ]) {
    assert.equal(isReadOnlyStatement(sql), false, sql)
  }
})

test('唯一约束冲突按错误码识别', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true)
  assert.equal(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' })), true)
  assert.equal(isUniqueViolation({ code: '08006' }), false)
  assert.equal(isUniqueViolation(new Error('连接被断开')), false)
  assert.equal(isUniqueViolation(null), false)
  assert.equal(isUniqueViolation(undefined), false)
})

// 下面这几条要真实数据库,所以在上面的环境变量设置之后才加载 db 模块
let sessionId = ''

before(async () => {
  await runMigrations({ quiet: true })
  const db = getDb()
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (name, email) VALUES ('数据层测试', 'db-test@loop.local') RETURNING id`,
  )
  const project = await db.query<{ id: string }>(
    `INSERT INTO projects (name, objective, created_by) VALUES ('数据层测试', '验证消息序号', $1)
     RETURNING id`,
    [user.rows[0]!.id],
  )
  const session = await createSession(db, project.rows[0]!.id, 'chat', user.rows[0]!.id)
  sessionId = session.id
})

after(async () => {
  await closeDb()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('同一会话的消息按写入顺序编号', async () => {
  const db = getDb()
  await addMessage(db, sessionId, 'user', '第一个问题')
  await addMessage(db, sessionId, 'assistant', '回答')

  const seqs = await db.query<{ seq: number }>(
    'SELECT seq FROM session_messages WHERE session_id = $1 ORDER BY seq',
    [sessionId],
  )
  assert.deepEqual(seqs.rows.map((row) => row.seq), [1, 2])
})

test('同一会话里重复的序号写不进去', async () => {
  const db = getDb()

  // 重复序号在写入那一刻就被约束挡住,不会悄悄留下两条次序相同的消息
  await assert.rejects(
    db.query(
      `INSERT INTO session_messages (session_id, role, content, seq)
       VALUES ($1, 'assistant', '重复序号', 2)`,
      [sessionId],
    ),
    (error: unknown) => (error as { code?: string }).code === '23505',
  )
})
