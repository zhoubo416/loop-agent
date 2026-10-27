import type { Ref } from 'vue'

export interface ActionLifecycleOptions {
  /** 取消前是否弹浏览器确认,页面自己有确认弹窗时传 false */
  confirmCancel?: boolean
}

export function useActionLifecycle(
  projectId: Ref<string>,
  actionId: Ref<string>,
  refresh: () => Promise<unknown>,
  options: ActionLifecycleOptions = {},
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
    notice.value = '智能体正在根据这个结果继续推进…'
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
    notice.value = '智能体正在根据这个结果继续推进…'
    try {
      const result = await api.post<{ agent_run_id: string | null }>(
        `/projects/${projectId.value}/actions/${actionId.value}/fail`,
        { reason },
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

  async function cancel(reason?: string) {
    if (busy.value) return
    if (options.confirmCancel !== false && !window.confirm('确认取消这个 Action?')) return
    busy.value = true
    error.value = ''
    notice.value = '智能体正在根据这个结果继续推进…'
    try {
      await api.post(`/projects/${projectId.value}/actions/${actionId.value}/cancel`, { reason })
      await refresh()
      notice.value = ''
    } catch (caught) {
      error.value = (caught as Error).message
      notice.value = ''
    } finally {
      busy.value = false
    }
  }

  return { busy, error, notice, complete, fail, cancel }
}
