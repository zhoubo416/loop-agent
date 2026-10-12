import { getDb, type Db } from '../db/client.js'
import { insertObservation, type ObservationRow } from '../modules/observations.js'
import { insertRun, type AgentRunRow } from '../modules/runs.js'
import { assertProjectAcceptsInput, requireProjectAccess } from '../modules/access.js'

export interface SubmitObservationInput {
  projectId: string
  userId: string
  type: string
  content: string
  source?: string
  sessionId?: string | null
  metadata?: Record<string, unknown>
  /** 是否立刻创建 Agent Run,默认 true */
  trigger?: boolean
}

export interface SubmitObservationResult {
  observation: ObservationRow
  run?: AgentRunRow
}

/**
 * Observation 与 Agent Run 必须在同一个事务里创建,
 * 否则会出现“Observation 已创建但 Trigger 丢失”的断链。
 * 对应 docs/design/02-database-design.md 第 27.1 节。
 */
export async function submitObservation(
  input: SubmitObservationInput,
  db: Db = getDb(),
): Promise<SubmitObservationResult> {
  const project = await requireProjectAccess(db, input.projectId, input.userId, 'member')
  assertProjectAcceptsInput(project, true)

  return db.transaction(async (tx) => {
    const observation = await insertObservation(tx, {
      projectId: input.projectId,
      type: input.type,
      content: input.content,
      source: input.source,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      metadata: input.metadata ?? {},
    })

    let run: AgentRunRow | undefined
    if (input.trigger !== false) {
      run = await insertRun(tx, {
        projectId: input.projectId,
        triggerType: 'observation',
        triggerId: observation.id,
        sessionId: input.sessionId ?? null,
        inputContext: { observation_type: input.type, source: input.source ?? null },
      })
    }

    if (project.status === 'created') {
      await tx.query(`UPDATE projects SET status = 'active', updated_at = now() WHERE id = $1`, [
        input.projectId,
      ])
    }

    return { observation, run }
  })
}

export async function createManualRun(
  projectId: string,
  userId: string,
  inputContext: Record<string, unknown> = {},
): Promise<AgentRunRow> {
  const db = getDb()
  const project = await requireProjectAccess(db, projectId, userId, 'member')
  assertProjectAcceptsInput(project, true)
  return insertRun(db, {
    projectId,
    triggerType: 'manual',
    inputContext,
  })
}
