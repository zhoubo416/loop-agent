import { getDb, closeDb } from './client.js'
import { runMigrations } from './migrate.js'
import { config } from '../config.js'
import path from 'node:path'

export async function ensureDevUser(): Promise<{ id: string; name: string; email: string }> {
  const db = getDb()
  const existing = await db.query<{ id: string; name: string; email: string }>(
    'SELECT id, name, email FROM users WHERE email = $1',
    [config.devUserEmail],
  )
  const found = existing.rows[0]
  if (found) return found

  const created = await db.query<{ id: string; name: string; email: string }>(
    `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email`,
    ['开发用户', config.devUserEmail],
  )
  return created.rows[0]!
}

async function main(): Promise<void> {
  await runMigrations({ quiet: true })
  const user = await ensureDevUser()
  console.log(`开发用户:${user.name} <${user.email}> ${user.id}`)
  await closeDb()
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
