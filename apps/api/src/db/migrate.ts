import fs from 'node:fs/promises'
import path from 'node:path'
import { getDb, closeDb } from './client.js'

const migrationsDir = path.resolve(import.meta.dirname, 'migrations')

export async function runMigrations(options: { quiet?: boolean } = {}): Promise<string[]> {
  const db = getDb()
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations')
  const done = new Set(applied.rows.map((row) => row.name))

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
  const executed: string[] = []

  for (const file of files) {
    if (done.has(file)) continue
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    await db.transaction(async (tx) => {
      await tx.exec(sql)
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    })
    executed.push(file)
    if (!options.quiet) console.log(`已应用 migration:${file}`)
  }

  if (!options.quiet && executed.length === 0) {
    console.log('数据库结构已是最新。')
  }
  return executed
}

async function main(): Promise<void> {
  const db = getDb()
  console.log(`数据库:${db.describe()}`)
  await runMigrations()
  await closeDb()
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
