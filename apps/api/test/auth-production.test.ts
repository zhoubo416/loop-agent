import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'

const dataDir = path.resolve(import.meta.dirname, '../.data/auth-production-test-pglite')
fs.rmSync(dataDir, { recursive: true, force: true })
process.env.NODE_ENV = 'production'
process.env.ALLOW_DEV_USER_HEADER = 'false'
process.env.PGDATA_DIR = dataDir
delete process.env.DATABASE_URL
process.env.WORKER_ENABLED = 'false'

const { buildServer } = await import('../src/http/server.js')
const { getDb, closeDb } = await import('../src/db/client.js')
const { runMigrations } = await import('../src/db/migrate.js')
const { ensureDevUser } = await import('../src/db/seed.js')
const { assertSafeUrl } = await import('../src/http/routes/documents.js')

const app = buildServer()
let userId = ''

before(async () => {
  await runMigrations({ quiet: true })
  await app.ready()
  userId = (await ensureDevUser()).id
})

after(async () => {
  await app.close()
  await closeDb()
})

test('生产环境拒绝 X-User-Id,但仍接受有效 Bearer Token', async () => {
  const spoofed = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { 'x-user-id': userId },
  })
  assert.equal(spoofed.statusCode, 401)

  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      name: '生产用户',
      email: 'production-auth@loop.local',
      password: 'password-123',
    },
  })
  assert.equal(registered.statusCode, 201)
  const token = JSON.parse(registered.body).token as string

  const authenticated = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(authenticated.statusCode, 200)
  assert.equal(JSON.parse(authenticated.body).email, 'production-auth@loop.local')
})

test('生产环境的 URL 导入拒绝 localhost 和内网地址', async () => {
  await assert.rejects(() => assertSafeUrl('http://localhost:4000/health'), /本机或内网地址/)
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1:4000/health'), /本机或内网地址/)
  await assert.rejects(() => assertSafeUrl('http://[::1]:4000/health'), /本机或内网地址/)
})
