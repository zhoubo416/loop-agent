export interface NotificationItem {
  id: string
  type: string
  severity: string
  title: string
  content: string
  status: string
  created_at: string
}

/**
 * 当前项目的通知
 *
 * 侧边栏会话列表里的未读数和通知页都要这份数据,靠 useAsyncData 的同 key 共享:
 * 两处拿到的是同一份 state 和同一个 refresh,通知页标记已读后,
 * 侧边栏的角标会一起更新
 */
export function useNotifications(projectId: Ref<string | undefined>) {
  const api = useApi()

  const { data, pending, refresh } = useAsyncData(
    () => `notifications-${projectId.value ?? 'none'}`,
    () =>
      projectId.value
        ? api.get<{ items: NotificationItem[]; unread_count: number }>(
            `/notifications?project_id=${projectId.value}`,
          )
        : Promise.resolve({ items: [] as NotificationItem[], unread_count: 0 }),
    { watch: [projectId] },
  )

  const busy = ref(false)

  /** 标记已读后重新拉一次,列表和未读数都由这一份数据决定 */
  async function read(id: string) {
    busy.value = true
    try {
      await api.post(`/notifications/${id}/read`, {})
      await refresh()
    } finally {
      busy.value = false
    }
  }

  /** 只清当前项目的未读,别的项目不受影响 */
  async function readAll() {
    busy.value = true
    try {
      await api.post('/notifications/read-all', { project_id: projectId.value })
      await refresh()
    } finally {
      busy.value = false
    }
  }

  return {
    items: computed(() => data.value?.items ?? []),
    unreadCount: computed(() => data.value?.unread_count ?? 0),
    pending,
    busy,
    refresh,
    read,
    readAll,
  }
}
