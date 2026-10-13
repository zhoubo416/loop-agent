import { getDb } from '../db/client.js'
import { config } from '../config.js'
import { AgentEngineError } from '../agent/engine.js'
import { getEngine } from '../agent/engine-factory.js'
import { buildAgentInput } from '../agent/context-builder.js'
import { parseAgentOutput } from '../agent/output-validator.js'
import { completeRun, failRun, getRunById, requeueRun } from '../modules/runs.js'
import { ApiError } from '../http/errors.js'
import { processAgentOutput } from './output-processor.js'
import { createAgentToolContext } from '../tools/registry.js'
import { generateNotifications } from './notify.js'

export interface RunOutcome {
  runId: string
  status: 'completed' | 'failed' | 'requeued' | 'skipped'
  detail?: string
}

/**
 * 一次 Agent Run 的完整执行:
 * Context → Agent Engine → 校验 → 持久化。
 * 对应 docs/design/03-agent-runtime.md 第 42 节的 Runtime 主流程。
 */
export async function executeAgentRun(runId: string): Promise<RunOutcome> {
  const db = getDb()
  const run = await getRunById(db, runId)
  if (!run) return { runId, status: 'skipped', detail: 'Agent Run 不存在' }

  const project = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = $1', [
    run.project_id,
  ])
  const projectStatus = project.rows[0]?.status
  if (projectStatus === 'paused' || projectStatus === 'completed' || projectStatus === 'archived') {
    await failRun(db, run.id, {
      code: 'PROJECT_NOT_RUNNABLE',
      message: `Project 当前状态为 ${projectStatus},不执行 Agent Run`,
    })
    return { runId, status: 'failed', detail: `Project 状态 ${projectStatus}` }
  }

  const engine = getEngine()
  try {
    const input = await buildAgentInput(db, run)
    await db.query('UPDATE agent_runs SET input_context = $2::jsonb WHERE id = $1', [
      run.id,
      JSON.stringify({ ...input, _engine: engine.name }),
    ])

    const toolContext = createAgentToolContext(db, {
      projectId: run.project_id,
      runId: run.id,
    })
    const rawOutput = await engine.run(input, toolContext)
    const { output, warnings } = parseAgentOutput(rawOutput)
    const result = await processAgentOutput(db, run, output)
    await generateNotifications(db, run.project_id, result)

    await completeRun(db, run.id, {
      judgment: output.judgment ?? null,
      state_proposal: output.stateProposal ?? null,
      events: output.events ?? [],
      actions: output.actions ?? [],
      recommendations: output.recommendations ?? [],
      memories: output.memories ?? [],
      _meta: {
        engine: engine.name,
        warnings,
        persisted: result,
      },
    })

    return { runId, status: 'completed' }
  } catch (error) {
    return handleRunFailure(run.id, run.attempts, error)
  }
}

async function handleRunFailure(
  runId: string,
  attempts: number,
  error: unknown,
): Promise<RunOutcome> {
  const db = getDb()
  const retryable =
    (error instanceof AgentEngineError && error.retryable) ||
    (error instanceof ApiError && error.code === 'STATE_CONFLICT')
  const code =
    error instanceof AgentEngineError || error instanceof ApiError
      ? error.code
      : 'INTERNAL_ERROR'
  const message = error instanceof Error ? error.message : String(error)

  if (retryable && attempts <= config.agentEngineMaxRetries) {
    await requeueRun(db, runId)
    return { runId, status: 'requeued', detail: `${code}: ${message}` }
  }

  await failRun(db, runId, { code, message, retryable })
  return { runId, status: 'failed', detail: `${code}: ${message}` }
}
