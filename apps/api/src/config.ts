import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../../..')

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: int(process.env.PORT, 4000),
  host: process.env.HOST ?? '127.0.0.1',

  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  pgliteDataDir: process.env.PGDATA_DIR
    ? path.resolve(repoRoot, process.env.PGDATA_DIR)
    : path.resolve(repoRoot, '.data/pglite'),

  // 资料(kind=document)的文件存储与文本提取上限
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(repoRoot, process.env.UPLOAD_DIR)
    : path.resolve(repoRoot, '.data/uploads'),
  uploadMaxBytes: int(process.env.UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
  documentTextMaxChars: int(process.env.DOCUMENT_TEXT_MAX_CHARS, 200_000),
  documentContextMaxChars: int(process.env.DOCUMENT_CONTEXT_MAX_CHARS, 24_000),
  urlImportTimeoutMs: int(process.env.URL_IMPORT_TIMEOUT_MS, 30_000),

  agentEngine: (process.env.AGENT_ENGINE ?? 'pi').toLowerCase(),
  agentEngineBaseUrl: process.env.AGENT_ENGINE_BASE_URL ?? 'https://api.openai.com/v1',
  agentEngineApiKey: process.env.AGENT_ENGINE_API_KEY ?? '',
  agentEngineModel: process.env.AGENT_ENGINE_MODEL ?? 'gpt-4o-mini',
  agentEngineTimeoutMs: int(process.env.AGENT_ENGINE_TIMEOUT_MS, 120_000),
  agentEngineMaxRetries: int(process.env.AGENT_ENGINE_MAX_RETRIES, 2),

  workerEnabled: bool(process.env.WORKER_ENABLED, true),
  workerIntervalMs: int(process.env.WORKER_INTERVAL_MS, 1_000),
  schedulerIntervalMs: int(process.env.SCHEDULER_INTERVAL_MS, 10_000),
  runLockTtlMs: int(process.env.RUN_LOCK_TTL_MS, 5 * 60_000),

  devUserEmail: process.env.DEV_USER_EMAIL ?? 'dev@loop.local',
  // 开发环境允许无凭据获取开发用户身份;生产环境关闭
  allowDevLogin: process.env.NODE_ENV !== 'production',
}

export type Config = typeof config
