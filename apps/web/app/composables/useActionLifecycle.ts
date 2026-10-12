import type { Ref } from 'vue'

export function useActionLifecycle(
  projectId: Ref<string>,
  actionId: Ref<string>,
  refresh: () => Promise<unknown>,
) {
  const api = useApi()
  const { waitForRun } = useRunWaiter()
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')

  async function complete(output: Record<string, unknown>, summary?: string) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    notice.value = 'Agent 正在根据这个结果继续推进…'
    try {
      const result = await api.post<{ agent_run_id: string | null }>(
        `/projects/${projectId.value}/actions/${actionId.value}/complete`,
        { result: { summary, output } },
      )
      if (result.agent_run_id) await waitForRun(projectId.value, result.agent_run_id)
      await refresh()
      notice.value = ''
    } catch (caught) {
      error.value = (caught as Error).message
      notice.value = ''
    } finally {
      busy.value = false
    }
  }

  async function fail(reason: string) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      const result = await api.post<{ agent_run_id: string | null }>(
        `/projects/${projectId.value}/actions/${actionId.value}/fail`,
        { reason },
      )
      if (result.agent_run_id) await waitForRun(projectId.value, result.agent_run_id)
      await refresh()
    } catch (caught) {
      error.value = (caught as Error).message
    } finally {
      busy.value = false
    }
  }

  async function cancel(reason?: string) {
    if (busy.value) return
    if (!window.confirm('确认取消这个 Action?')) return
    busy.value = true
    error.value = ''
    try {
      await api.post(`/projects/${projectId.value}/actions/${actionId.value}/cancel`, { reason })
      await refresh()
    } catch (caught) {
      error.value = (caught as Error).message
    } finally {
      busy.value = false
    }
  }

  return { busy, error, notice, complete, fail, cancel }
}
