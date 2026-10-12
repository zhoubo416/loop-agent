import { config } from './config.js'
import { buildServer } from './http/server.js'
import { closeDb, getDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { ensureDevUser } from './db/seed.js'
import { getEngine } from './agent/engine-factory.js'
import { RuntimeWorker } from './runtime/worker.js'
import { Scheduler } from './runtime/scheduler.js'
import { cleanupStaleIdempotency } from './modules/idempotency.js'

async function main(): Promise<void> {
  const db = getDb()
  await runMigrations({ quiet: true })
  const user = await ensureDevUser()
  const engine = getEngine()
  const engineHealth = await engine.healthCheck()

  const app = buildServer()
  await app.listen({ port: config.port, host: config.host })

  const worker = new RuntimeWorker()
  const scheduler = new Scheduler()
  if (config.workerEnabled) {
    worker.start()
    scheduler.start()
    const cleanupTimer = setInterval(() => {
      void cleanupStaleIdempotency(getDb()).catch((error) => {
        console.warn('[maintenance] 清理过期幂等键失败', error)
      })
    }, 60_000)
    cleanupTimer.unref()
  }

  console.log(`LOOP API 已启动:http://${config.host}:${config.port}`)
  console.log(`数据库:${db.describe()}`)
  console.log(`Agent Engine:${engine.name}${engineHealth.ok ? '' : `(不可用:${engineHealth.detail} )`}`)
  console.log(`开发用户:${user.name} <${user.email}> ${user.id}`)

  const shutdown = async (signal: string) => {
    console.log(`收到 ${signal},正在关闭...`)
    worker.stop()
    scheduler.stop()
    await app.close()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(async (error) => {
  console.error('LOOP API 启动失败', error)
  await closeDb().catch(() => {})
  process.exit(1)
})
