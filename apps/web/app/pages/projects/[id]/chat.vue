<script setup lang="ts">
interface SessionItem {
  id: string
  type: string
  created_at: string
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

// 首屏由服务端取回最近一次会话,客户端继续沿用同一份数据
const { data: initial, pending } = await useAsyncData(
  () => `chat-${projectId.value}`,
  async () => {
    const sessions = await api.get<{ items: SessionItem[] }>(
      `/projects/${projectId.value}/sessions`,
    )
    const chat = sessions.items.find((item) => item.type === 'chat')
    if (!chat) return { sessionId: null, messages: [] as MessageItem[] }
    const result = await api.get<{ items: MessageItem[] }>(
      `/projects/${projectId.value}/sessions/${chat.id}/messages`,
    )
    return { sessionId: chat.id, messages: result.items }
  },
)

const sessionId = ref<string | null>(initial.value?.sessionId ?? null)
const messages = ref<MessageItem[]>(initial.value?.messages ?? [])
const draft = ref('')
const sending = ref(false)
const error = ref('')
const runStatus = ref('')

// 新消息进入后自动滚到页面底部,保持最新内容可见
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  },
)

async function loadMessages(id: string) {
  const result = await api.get<{ items: MessageItem[] }>(
    `/projects/${projectId.value}/sessions/${id}/messages`,
  )
  messages.value = result.items
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  error.value = ''
  sending.value = true
  draft.value = ''
  runStatus.value = '智能体正在基于这条信息判断项目状态…'

  messages.value.push({
    id: `pending-${Date.now()}`,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  })

  try {
    const response = await api.post<{ session_id: string; agent_run_id: string | null }>(
      `/projects/${projectId.value}/chat`,
      { content, ...(sessionId.value ? { session_id: sessionId.value } : {}) },
    )
    sessionId.value = response.session_id

    if (response.agent_run_id) {
      const run = await waitForRun(projectId.value, response.agent_run_id)
      if (run?.status === 'failed') {
        error.value = run.error?.message ?? '智能体运行失败'
      } else if (run === null) {
        error.value = '智能体运行超时,可以在时间线里查看最终状态'
      }
    }
    await loadMessages(response.session_id)
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
  <UContainer>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">对话</h1>
        <p class="text-muted">
          你的输入会变成一条观察,由智能体判断它对项目意味着什么。
        </p>
      </div>
      <UButton :to="`/projects/${projectId}`" color="neutral" variant="outline">
        回到概览
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

    <div class="flex flex-col gap-3">
      <template v-if="pending && !initial">
        <USkeleton v-for="n in 3" :key="n" class="lo-message h-16 rounded-xl" />
      </template>
      <p v-else-if="!messages.length" class="text-sm text-muted">
        还没有对话。试着告诉智能体项目现在发生了什么,例如“第一轮实验已经完成,结果不错”。
      </p>
      <div
        v-for="message in messages"
        :key="message.id"
        class="lo-message"
        :class="message.role === 'user' ? 'lo-message-user' : ''"
      >
        <UCard
          :ui="{ body: 'sm:p-3' }"
          :variant="message.role === 'assistant' ? 'outline' : 'soft'"
          :class="message.role === 'user' ? 'bg-primary/5' : ''"
        >
          <div class="mb-1 text-xs text-muted">
            {{ message.role === 'user' ? '我' : '智能体' }} ·
            {{ formatDateTime(message.created_at) }}
          </div>
          <div class="whitespace-pre-wrap">{{ message.content }}</div>
        </UCard>
      </div>
      <UCard v-if="sending" :ui="{ body: 'sm:p-3' }" variant="outline" class="lo-message">
        <div class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          {{ runStatus || '智能体正在思考…' }}
        </div>
      </UCard>
    </div>

    <UCard class="sticky bottom-0 z-10 mt-6 shadow-lg">
      <div class="flex flex-col gap-3">
        <UTextarea
          v-model="draft"
          :rows="3"
          class="w-full"
          placeholder="告诉智能体项目现在发生了什么…(⌘/Ctrl + 回车 发送)"
          @keydown.meta.enter="send"
          @keydown.ctrl.enter="send"
        />
        <div class="flex justify-end">
          <UButton :loading="sending" @click="send">发送</UButton>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
