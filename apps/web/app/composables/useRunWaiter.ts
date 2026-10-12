export interface RunSummary {
  id: string
  status: string
  output?: { judgment?: string | null } | null
  error?: { code?: string; message?: string } | null
}

/**
 * Agent 是异步运行的:提交之后由前端轮询 Run 状态。
 */
export function useRunWaiter() {
  const api = useApi()

  async function waitForRun(
    projectId: string,
    runId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<RunSummary | null> {
    const timeoutMs = options.timeoutMs ?? 180_000
    const intervalMs = options.intervalMs ?? 1_500
    const started = Date.now()

    while (Date.now() - started < timeoutMs) {
      const run = await api.get<RunSummary>(`/projects/${projectId}/runs/${runId}`)
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return null
  }

  return { waitForRun }
}
