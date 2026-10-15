<script setup lang="ts">
import MarkdownIt from 'markdown-it'

interface SessionItem {
  id: string
  type: string
  created_at: string
  preview: string | null
  message_count: number
}

interface MessageItem {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
}

const route = useRoute()
const api = useApi()
const { waitForRun } = useRunWaiter()
const projectId = computed(() => route.params.id as string)

// markdown-it 单例:默认不渲染原始 HTML,AI 回复里的 HTML 一律转义
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(content: string): string {
  return md.render(content)
}

// 会话列表:最新在前;首屏直接选最新一个
const { data: sessions, pending: sessionsPending, refresh: refreshSessions } = await useAsyncData(
  () => `chat-sessions-${projectId.value}`,
  () => api.get<{ items: SessionItem[] }>(`/projects/${projectId.value}/sessions?type=chat`),
)

// 从资料页带 ?doc= 进入:默认开新对话,并把资料文本作为上下文随每条消息发送
const pinnedDoc = ref<{ id: string; title: string } | null>(null)
const docParam = route.query.doc as string | undefined
if (docParam) {
  const docAction = await api
    .get<{ id: string; title: string }>(`/projects/${projectId.value}/actions/${docParam}`)
    .catch(() => null)
  if (docAction) pinnedDoc.value = { id: docAction.id, title: docAction.title }
}

const sessionId = ref<string | null>(
  pinnedDoc.value ? null : sessions.value?.items[0]?.id ?? null,
)
const messages = ref<MessageItem[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref('')
const runStatus = ref('')
const insights = ref<{ refresh: () => Promise<void> } | null>(null)

// 首屏加载当前会话的消息
if (sessionId.value) {
  const initial = await api.get<{ items: MessageItem[] }>(
    `/projects/${projectId.value}/sessions/${sessionId.value}/messages`,
  )
  messages.value = initial.items
}

function sessionTitle(item: SessionItem): string {
  const text = (item.preview ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || '历史对话'
}

// 新消息进入后自动滚到消息区底部,保持最新内容可见
const scrollBox = ref<HTMLElement | null>(null)
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    scrollBox.value?.scrollTo({ top: scrollBox.value.scrollHeight, behavior: 'smooth' })
  },
  { immediate: true },
)

async function loadMessages(id: string) {
  const result = await api.get<{ items: MessageItem[] }>(
    `/projects/${projectId.value}/sessions/${id}/messages`,
  )
  messages.value = result.items
}

function switchSession(id: string) {
  if (id === sessionId.value || sending.value) return
  sessionId.value = id
  // 资料上下文只属于从资料页开始的那段对话,切到历史会话就摘掉
  pinnedDoc.value = null
  void loadMessages(id)
}

function newConversation() {
  if (sending.value) return
  sessionId.value = null
  messages.value = []
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  error.value = ''
  sending.value = true
  draft.value = ''
  runStatus.value = '智能体正在输入…'

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
      ...(sessionId.value ? { session_id: sessionId.value } : {}),
      ...(pinnedDoc.value ? { document_id: pinnedDoc.value.id } : {}),
    })
    sessionId.value = response.session_id
    // 对话回复立即进入消息流,思考在后台异步进行
    await loadMessages(response.session_id)
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
  <!-- 不用 UContainer:聊天页需要三栏拉满整个内容区宽度 -->
  <div class="lo-chat-shell">
    <div class="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <!-- 左:历史对话列表(窄屏收起,用对话区顶部的标签行代替) -->
      <aside class="hidden min-h-0 w-60 shrink-0 flex-col gap-2 rounded-xl bg-elevated/50 p-3 lg:flex">
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          block
          @click="newConversation"
        >
          新对话
        </UButton>
        <p class="px-2.5 pt-1 text-xs text-muted">历史对话</p>
        <div v-if="sessionsPending && !sessions" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <USkeleton v-for="n in 4" :key="n" class="h-12 shrink-0 rounded-lg" />
        </div>
        <div v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
          <button
            v-for="session in sessions?.items ?? []"
            :key="session.id"
            class="rounded-lg px-2.5 py-2 text-left text-sm transition-colors"
            :class="session.id === sessionId ? 'bg-primary/10 font-medium' : 'hover:bg-elevated/60'"
            :title="session.preview ?? '历史对话'"
            @click="switchSession(session.id)"
          >
            <span class="line-clamp-2 break-words">{{ session.preview || '历史对话' }}</span>
            <span class="mt-0.5 block text-[11px] text-muted">
              {{ formatDateTime(session.created_at) }} · {{ session.message_count }} 条
            </span>
          </button>
          <p v-if="!(sessions?.items ?? []).length" class="px-2.5 text-xs text-muted">
            还没有历史对话
          </p>
        </div>
      </aside>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">对话</h1>
          <div class="flex items-center gap-2">
            <UButton
              icon="i-lucide-plus"
              size="xs"
              color="neutral"
              variant="outline"
              class="lg:hidden"
              @click="newConversation"
            >
              新对话
            </UButton>
            <UButton :to="`/projects/${projectId}`" color="neutral" variant="ghost" size="xs">
              回到概览
            </UButton>
          </div>
        </div>

        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3 shrink-0" />

        <div v-if="sessionsPending && !sessions" class="mb-3 flex shrink-0 gap-2 overflow-hidden lg:hidden">
          <USkeleton v-for="n in 3" :key="n" class="h-6 w-24 shrink-0 rounded-full" />
        </div>
        <div
          v-else-if="(sessions?.items ?? []).length"
          class="mb-3 flex shrink-0 items-center gap-2 overflow-x-auto pb-1 lg:hidden"
        >
          <UBadge
            v-for="session in sessions?.items ?? []"
            :key="session.id"
            variant="subtle"
            :color="session.id === sessionId ? 'primary' : 'neutral'"
            class="shrink-0 cursor-pointer"
            :title="session.preview ?? '历史对话'"
            @click="switchSession(session.id)"
          >
            {{ sessionTitle(session) }}
          </UBadge>
        </div>

        <div ref="scrollBox" class="mb-4 min-h-0 flex-1 overflow-y-auto">
          <div class="flex flex-col gap-4">
            <template v-if="sessionsPending && !sessions">
              <USkeleton v-for="n in 3" :key="n" class="h-16 rounded-xl" />
            </template>
            <p v-else-if="!messages.length" class="text-sm text-muted">
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

      <aside class="flex w-full shrink-0 flex-col lg:mr-2 lg:w-80">
        <ChatInsights ref="insights" :project-id="projectId" :session-id="sessionId" />
      </aside>
    </div>
  </div>
</template>