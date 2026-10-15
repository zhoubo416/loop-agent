<script setup lang="ts">
import MarkdownIt from 'markdown-it'

interface MessageItem {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
}

const route = useRoute()
const router = useRouter()
const api = useApi()
const { waitForRun } = useRunWaiter()
const projectId = computed(() => route.params.id as string)

// 会话 id 以 URL 为准:侧边栏切换、刷新页面、浏览器回退都落在同一段对话上
const sessionId = computed(() => (route.query.session as string | undefined) || null)
const {
  sessions,
  pending: sessionsPending,
  refresh: refreshSessions,
} = useChatSessions(projectId)

// 窄屏没有侧边栏会话列表,这条「通知」跟着会话一起排进标签行
const { unreadCount } = useNotifications(projectId)

// markdown-it 单例:默认不渲染原始 HTML,AI 回复里的 HTML 一律转义
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(content: string): string {
  return md.render(content)
}

const messages = ref<MessageItem[]>([])
const loadedSessionId = ref<string | null>(null)
const loadingSession = ref(false)
const pinnedDoc = ref<{ id: string; title: string } | null>(null)
const draft = ref('')
const sending = ref(false)
const error = ref('')
const runStatus = ref('')
const insights = ref<{ refresh: () => Promise<void> } | null>(null)
const scrollBox = ref<HTMLElement | null>(null)

function sessionTitle(item: ChatSessionItem): string {
  const text = (item.preview ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '历史对话'
}

// 每次加载领一个号,只有最新一次请求能改页面状态,旧的返回一律丢掉
let loadRound = 0

/**
 * 加载一段会话的消息
 *
 * 换会话时先把上一段对话清空,用骨架屏占住位置,避免旧对话留在屏幕上被当成这一段的内容;
 * 发送消息后的再次加载用 silent,消息留在原地,等新内容整体替换
 */
async function loadSession(
  id: string | null,
  options: { force?: boolean; silent?: boolean } = {},
) {
  const { force = false, silent = false } = options
  if (!force && id === loadedSessionId.value) return
  // 先记下目标会话,URL 变化触发的重复加载会被挡掉
  loadedSessionId.value = id
  const round = ++loadRound

  if (!silent) {
    messages.value = []
    error.value = ''
    loadingSession.value = id !== null
  }
  if (!id) return

  try {
    const result = await api.get<{ items: MessageItem[] }>(
      `/projects/${projectId.value}/sessions/${id}/messages`,
    )
    if (round !== loadRound) return
    // 收起骨架屏和放入消息在同一次刷新里完成,新对话才落在滚动位置的底端
    loadingSession.value = false
    messages.value = result.items
    if (!silent) {
      // 整段对话刚换过,直接落到最新一条,不做从顶部滑到底部的长动画
      await nextTick()
      scrollBox.value?.scrollTo({ top: scrollBox.value.scrollHeight, behavior: 'auto' })
    }
  } catch (caught) {
    if (round !== loadRound) return
    loadedSessionId.value = null
    loadingSession.value = false
    error.value = (caught as Error).message
  }
}

// 资料 pin 跟着 URL 里的 doc 参数走:从资料页进入时带上,切到别的会话就摘掉
async function syncPinnedDoc() {
  const docId = (route.query.doc as string | undefined) || null
  if (!docId) {
    pinnedDoc.value = null
    return
  }
  if (pinnedDoc.value?.id === docId) return
  const docAction = await api
    .get<{ id: string; title: string }>(`/projects/${projectId.value}/actions/${docId}`)
    .catch(() => null)
  pinnedDoc.value = docAction ? { id: docAction.id, title: docAction.title } : null
}

await syncPinnedDoc()
await loadSession(sessionId.value)

watch([sessionId, () => route.query.doc, projectId], async () => {
  await syncPinnedDoc()
  await loadSession(sessionId.value)
})

// 消息区里的内容变化后自动滚到底部,保持最新内容可见
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    scrollBox.value?.scrollTo({ top: scrollBox.value.scrollHeight, behavior: 'smooth' })
  },
  { immediate: true },
)

function switchSession(id: string) {
  if (id === sessionId.value) return
  void navigateTo({ path: route.path, query: { session: id } })
}

function openNotifications() {
  void navigateTo(`/projects/${projectId.value}/notifications`)
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  error.value = ''
  sending.value = true
  draft.value = ''
  runStatus.value = '智能体正在输入…'

  // 记下这条消息属于哪一段讨论:发送期间用户可能从侧边栏切走
  const sentSessionId = sessionId.value

  messages.value.push({
    id: `pending-${Date.now()}`,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  })

  try {
    const response = await api.post<{
      session_id: string
      reply: string
      observation_id: string
      agent_run_id: string | null
    }>(`/projects/${projectId.value}/chat`, {
      content,
      ...(sentSessionId ? { session_id: sentSessionId } : {}),
      ...(pinnedDoc.value ? { document_id: pinnedDoc.value.id } : {}),
    })

    if (sessionId.value === sentSessionId) {
      // 这段是新会话:把 session 写进 URL,侧边栏高亮和刷新后的落点都跟着走
      if (response.session_id !== sentSessionId) {
        await router.replace({ query: { ...route.query, session: response.session_id } })
      }
      await loadSession(response.session_id, { force: true, silent: true })
    }
    // 对话回复立即进入消息流,思考在后台异步进行
    void refreshSessions()

    if (response.agent_run_id) {
      void (async () => {
        try {
          await insights.value?.refresh()
          await waitForRun(projectId.value, response.agent_run_id!, {
            timeoutMs: 300_000,
          })
        } finally {
          await insights.value?.refresh()
        }
      })()
    }
  } catch (caught) {
    error.value = (caught as Error).message
    messages.value = messages.value.filter((item) => !item.id.startsWith('pending-'))
  } finally {
    sending.value = false
    runStatus.value = ''
  }
}
</script>

<template>
  <UContainer class="lo-chat-shell">
    <!-- 内容宽度和行动、时间线等页面一致,两边留白由 UContainer 提供 -->
    <div class="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="mb-4 flex shrink-0 items-center justify-between gap-3">
          <h1 class="text-xl font-semibold">对话</h1>
          <UButton :to="`/projects/${projectId}`" color="neutral" variant="ghost" size="xs">
            回到概览
          </UButton>
        </div>

        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3 shrink-0" />

        <!-- 窄屏侧边栏不显示会话列表,历史对话改为这里的横向标签行 -->
        <div class="lo-session-tabs mb-3 shrink-0 items-center gap-2 overflow-x-auto pb-1">
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="outline"
            :to="`/projects/${projectId}/chat`"
            class="shrink-0"
          >
            新对话
          </UButton>
          <UBadge
            icon="i-lucide-bell"
            variant="subtle"
            color="primary"
            class="shrink-0 cursor-pointer"
            title="通知"
            @click="openNotifications()"
          >
            通知{{ unreadCount ? ` ${unreadCount}` : '' }}
          </UBadge>
          <template v-if="sessionsPending && !sessions.length">
            <USkeleton
              v-for="n in 3"
              :key="n"
              class="h-6 w-24 shrink-0 rounded-full"
            />
          </template>
          <template v-else>
            <UBadge
              v-for="session in sessions"
              :key="session.id"
              variant="subtle"
              :color="session.id === sessionId ? 'primary' : 'neutral'"
              class="shrink-0 cursor-pointer"
              :title="session.preview ?? '历史对话'"
              @click="switchSession(session.id)"
            >
              {{ sessionTitle(session) }}
            </UBadge>
          </template>
        </div>

        <div ref="scrollBox" class="mb-4 min-h-0 flex-1 overflow-y-auto">
          <div class="flex flex-col gap-4">
            <template v-if="sessionsPending && !sessions.length">
              <USkeleton v-for="n in 3" :key="n" class="h-16 rounded-xl" />
            </template>
            <!-- 换会话:上一段对话已经清空,用和消息形状一致的骨架占位 -->
            <template v-else-if="loadingSession">
              <USkeleton class="h-12 w-2/3 self-end rounded-2xl rounded-br-sm" />
              <div class="flex w-full flex-col gap-2">
                <USkeleton class="h-3 w-24 rounded-full" />
                <USkeleton class="h-24 w-full rounded-lg" />
              </div>
              <USkeleton class="h-12 w-1/2 self-end rounded-2xl rounded-br-sm" />
            </template>
            <!-- 加载失败时上面已经有报错,这里不再说「没有消息」 -->
            <p v-else-if="!messages.length && !error" class="text-sm text-muted">
              {{ sessionId ? '这个会话还没有消息。' : '开始一段新对话,告诉智能体项目现在发生了什么。' }}
            </p>
            <template v-else>
              <div
                v-for="message in messages"
                :key="message.id"
                class="flex flex-col"
                :class="message.role === 'user' ? 'items-end' : 'items-start'"
              >
                <div
                  v-if="message.role === 'user'"
                  class="lo-bubble-user max-w-[78%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5"
                >
                  <div class="whitespace-pre-wrap break-words text-sm">{{ message.content }}</div>
                  <div class="mt-1 text-right text-[11px] text-muted">
                    {{ formatDateTime(message.created_at) }}
                  </div>
                </div>
                <div v-else class="w-full min-w-0">
                  <div class="mb-1 text-[11px] text-muted">
                    智能体 · {{ formatDateTime(message.created_at) }}
                  </div>
                  <!-- eslint-disable-next-line vue/no-v-html -- AI 回复按 Markdown 渲染,markdown-it 已转义原始 HTML -->
                  <div class="lo-md text-sm" v-html="renderMarkdown(message.content)"></div>
                </div>
              </div>
            </template>
            <div v-if="sending" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              {{ runStatus || '智能体正在输入…' }}
            </div>
          </div>
        </div>

        <div class="shrink-0">
          <div
            v-if="pinnedDoc"
            class="mb-2 flex items-center gap-2 rounded-xl bg-elevated/60 px-3 py-2 text-sm"
          >
            <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">资料:{{ pinnedDoc.title }}</span>
            <ULink
              :to="`/projects/${projectId}/documents/${pinnedDoc.id}`"
              class="shrink-0 text-xs text-muted hover:text-default"
            >
              查看
            </ULink>
            <button
              type="button"
              class="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-default"
              title="不再带这份资料讨论"
              @click="pinnedDoc = null"
            >
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
          <div class="lo-input-shell">
            <UTextarea
              v-model="draft"
              :rows="3"
              variant="none"
              class="w-full"
              :placeholder="pinnedDoc ? '和智能体讨论这份资料…(⌘/Ctrl + 回车发送)' : '和智能体讨论项目…(⌘/Ctrl + 回车发送)'"
              @keydown.meta.enter.prevent="send"
              @keydown.ctrl.enter.prevent="send"
            />
            <div class="flex items-center justify-between px-3 pb-2">
              <span class="text-[11px] text-muted">⌘/Ctrl + 回车发送</span>
              <UButton
                icon="i-lucide-arrow-up"
                size="sm"
                :padded="false"
                class="size-8 rounded-full"
                :loading="sending"
                :disabled="!draft.trim() || sending"
                @click="send"
              />
            </div>
          </div>
        </div>
      </div>

      <aside class="flex w-full shrink-0 flex-col lg:w-80">
        <ChatInsights ref="insights" :project-id="projectId" :session-id="sessionId" />
      </aside>
    </div>
  </UContainer>
</template>
