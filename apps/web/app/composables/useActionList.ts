import type { Ref } from 'vue'

export type ActionKind = 'task' | 'meeting' | 'document'

export interface UserItem {
  id: string
  name: string
  email: string | null
}

export interface ActionMeetingSummary {
  meeting_title: string | null
  started_at: string | null
  ended_at: string | null
  participants: string[]
  summary: string | null
  content_source: string
}

export interface ActionDocumentSummary {
  count: number
  names: string[]
  parsed_count: number
  unsupported_count: number
  failed_count: number
  extracted_chars: number
}

export interface ActionResultSummary {
  summary: string | null
  participants: string[]
}

export interface ActionListItem {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  kind: string
  executor_type: string
  assignee_id: string | null
  due_at: string | null
  created_at: string
  completed_at: string | null
  meeting?: ActionMeetingSummary | null
  documents?: ActionDocumentSummary | null
  result?: ActionResultSummary | null
}

/** 列表页共用的数据:按 kind 取行动,并行取成员给任务页的负责人筛选和指派用 */
export async function useActionList(projectId: Ref<string>, kind: ActionKind) {
  const api = useApi()
  const [{ data, refresh, pending }, { data: users }] = await Promise.all([
    useAsyncData(
      () => `action-list-${kind}-${projectId.value}`,
      () =>
        api.get<{ items: ActionListItem[] }>(
          `/projects/${projectId.value}/actions?kind=${kind}`,
        ),
    ),
    useAsyncData('users', () => api.get<{ items: UserItem[] }>('/users')),
  ])

  const items = computed(() => data.value?.items ?? [])
  const userOptions = computed(() =>
    (users.value?.items ?? []).map((user) => ({ label: user.name, value: user.id })),
  )

  return { items, userOptions, refresh, pending }
}

/** 列表行的确认 / 拒绝 / 指派:同一时间只处理一行,按钮自己转圈 */
export function useActionOps(projectId: Ref<string>, refresh: () => Promise<void>) {
  const api = useApi()
  const pendingId = ref<string | null>(null)
  const error = ref('')

  async function withBusy(id: string, fn: () => Promise<void>) {
    if (pendingId.value) return
    pendingId.value = id
    error.value = ''
    try {
      await fn()
    } catch (caught) {
      error.value = (caught as Error).message
    } finally {
      pendingId.value = null
    }
  }

  function assign(id: string, userId: string) {
    return withBusy(id, async () => {
      await api.patch(`/projects/${projectId.value}/actions/${id}`, {
        assignee_id: userId || null,
      })
      await refresh()
    })
  }

  function confirm(id: string) {
    return withBusy(id, async () => {
      await api.post(`/projects/${projectId.value}/actions/${id}/confirm`, {})
      await refresh()
    })
  }

  function decline(id: string) {
    return withBusy(id, async () => {
      await api.post(`/projects/${projectId.value}/actions/${id}/decline`, {})
      await refresh()
    })
  }

  return { pendingId, error, assign, confirm, decline }
}
