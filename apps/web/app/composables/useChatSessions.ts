export interface ChatSessionItem {
  id: string
  project_id: string
  type: string
  created_at: string
  /** 首条 user 消息内容,用作会话标题预览 */
  preview: string | null
  message_count: number
}

/**
 * 当前项目的对话会话列表
 *
 * 侧边栏和 Chat 页都要这份数据,靠 useAsyncData 的同 key 共享:
 * 两处拿到的是同一份 state 和同一个 refresh,对话页发完消息刷新,
 * 侧边栏的列表会一起更新
 */
export function useChatSessions(projectId: Ref<string | undefined>) {
  const api = useApi()

  const { data, pending, refresh } = useAsyncData(
    () => `chat-sessions-${projectId.value ?? 'none'}`,
    () =>
      projectId.value
        ? api.get<{ items: ChatSessionItem[] }>(`/projects/${projectId.value}/sessions?type=chat`)
        : Promise.resolve({ items: [] as ChatSessionItem[] }),
    { watch: [projectId] },
  )

  return {
    sessions: computed(() => data.value?.items ?? []),
    pending,
    refresh,
  }
}
