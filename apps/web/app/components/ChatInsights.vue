<script setup lang="ts">
interface InsightRun {
  id: string
  status: string
  created_at: string
  error: { code?: string; message?: string } | null
  judgment: string | null
  state_proposals: Array<{ id: string; proposal: Record<string, unknown>; status: string }>
  events: Array<{ id: string; title: string }>
  actions: Array<{ id: string; title: string; kind: string; priority: string; status: string }>
  recommendations: Array<{
    id: string
    type: string
    content: string
    priority: string
    status: string
  }>
}

const props = defineProps<{ projectId: string; sessionId: string | null }>()

const api = useApi()

/** 一次拉取的结果,连同它属于哪一段会话一起返回 */
interface InsightPayload {
  sessionId: string | null
  items: InsightRun[]
}

const {
  data,
  refresh,
  status,
  error: loadError,
} = useAsyncData<InsightPayload>(
  () => `chat-insights-${props.projectId}-${props.sessionId ?? 'none'}`,
  async () => ({
    sessionId: props.sessionId,
    items: props.sessionId
      ? (
          await api.get<{ items: InsightRun[] }>(
            `/projects/${props.projectId}/sessions/${props.sessionId}/runs`,
          )
        ).items
      : [],
  }),
  { watch: [() => props.projectId, () => props.sessionId] },
)

// 换会话时 Nuxt 会把上一段的结果先带进新的 key,所以只认属于当前会话的那一份,
// 其余一律当成还没加载:上一段的思考结果留在屏幕上会被当成这一段的内容
const items = computed(() =>
  data.value?.sessionId === props.sessionId ? data.value.items : [],
)
const loading = computed(
  () => !items.value.length && ['pending', 'idle'].includes(status.value),
)

/** 正在处理的那条产出:对应的按钮转圈,其余按钮先禁用,避免同时改同一个项目状态 */
const pendingId = ref<string | null>(null)
const error = ref('')

// 拉取失败和操作失败都在这条提示里说
const message = computed(() => error.value || loadError.value?.message || '')

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

function applyProposal(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/state/proposals/${id}/apply`, {})
    await refresh()
  })
}

function rejectProposal(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/state/proposals/${id}/reject`, {})
    await refresh()
  })
}

function confirmAction(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/actions/${id}/confirm`, {})
    await refresh()
  })
}

function declineAction(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/actions/${id}/decline`, {})
    await refresh()
  })
}

function acceptRecommendation(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/recommendations/${id}/accept`, {
      create_action: true,
    })
    await refresh()
  })
}

function rejectRecommendation(id: string) {
  void withBusy(id, async () => {
    await api.post(`/projects/${props.projectId}/recommendations/${id}/reject`, {})
    await refresh()
  })
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="mb-3 flex shrink-0 items-baseline justify-between gap-2">
      <span class="font-medium">思考结果</span>
      <span class="text-xs text-muted">对话触发的项目思考</span>
    </div>

    <UAlert v-if="message" color="error" variant="soft" :title="message" class="mb-3 shrink-0" />

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <!-- 换会话:上一段的思考结果已经让位,用和卡片形状一致的骨架占位 -->
      <div v-if="loading" class="flex flex-col gap-3">
        <USkeleton v-for="n in 2" :key="n" class="h-28 rounded-lg" />
      </div>
      <!-- 加载失败时上面已经有报错,这里不再说「还没有思考结果」 -->
      <p v-else-if="!items.length && !message" class="text-sm text-muted">
        还没有思考结果。发送消息后,智能体会基于这轮讨论判断项目状态。
      </p>
      <div v-else class="flex flex-col gap-3">
        <UCard v-for="item in items" :key="item.id" :ui="{ body: 'sm:p-3' }">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-muted">{{ formatDateTime(item.created_at) }}</span>
            <UBadge :color="statusColor(item.status)" variant="soft">
              <span
                v-if="['pending', 'running'].includes(item.status)"
                class="flex items-center gap-1"
              >
                <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
                思考中
              </span>
              <template v-else>{{ statusLabel(item.status) }}</template>
            </UBadge>
          </div>

          <p v-if="item.error" class="mt-2 text-sm text-error">{{ item.error.message }}</p>
          <p v-if="item.judgment" class="mt-2 whitespace-pre-wrap text-sm">{{ item.judgment }}</p>

          <div
            v-for="proposal in item.state_proposals"
            :key="proposal.id"
            class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-2"
          >
            <span class="text-sm">{{ proposalSummary(proposal.proposal).join(',') }}</span>
            <!-- 还没处理的给按钮,处理过的留一条状态:这一栏要能回看整轮思考的产出 -->
            <div v-if="proposal.status === 'pending'" class="flex items-center gap-1.5">
              <UButton
                size="xs"
                :loading="pendingId === proposal.id"
                :disabled="pendingId !== null"
                @click="applyProposal(proposal.id)"
              >
                应用
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="pendingId !== null"
                @click="rejectProposal(proposal.id)"
              >
                忽略
              </UButton>
            </div>
            <UBadge v-else :color="statusColor(proposal.status)" variant="soft">
              {{ statusLabel(proposal.status) }}
            </UBadge>
          </div>

          <div
            v-for="action in item.actions"
            :key="action.id"
            class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-2"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ action.title }}</div>
              <div class="text-xs text-muted">
                {{ kindLabel(action.kind) }} · {{ priorityLabel(action.priority) }}
              </div>
            </div>
            <div v-if="action.status === 'proposed'" class="flex shrink-0 items-center gap-1.5">
              <UButton
                size="xs"
                :loading="pendingId === action.id"
                :disabled="pendingId !== null"
                @click="confirmAction(action.id)"
              >
                确认
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                :disabled="pendingId !== null"
                @click="declineAction(action.id)"
              >
                拒绝
              </UButton>
            </div>
            <UBadge v-else :color="statusColor(action.status)" variant="soft" class="shrink-0">
              {{ statusLabel(action.status) }}
            </UBadge>
          </div>

          <div
            v-for="recommendation in item.recommendations"
            :key="recommendation.id"
            class="mt-2 rounded-lg border border-default p-2"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm">{{ recommendation.content }}</span>
              <div
                v-if="recommendation.status === 'pending'"
                class="flex shrink-0 items-center gap-1.5"
              >
                <UButton
                  size="xs"
                  :loading="pendingId === recommendation.id"
                  :disabled="pendingId !== null"
                  @click="acceptRecommendation(recommendation.id)"
                >
                  接受并生成行动
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="pendingId !== null"
                  @click="rejectRecommendation(recommendation.id)"
                >
                  忽略
                </UButton>
              </div>
              <UBadge v-else :color="statusColor(recommendation.status)" variant="soft" class="shrink-0">
                {{ statusLabel(recommendation.status) }}
              </UBadge>
            </div>
          </div>

          <div v-if="item.events.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="event in item.events"
              :key="event.id"
              class="rounded bg-elevated px-2 py-0.5 text-xs text-muted"
            >
              {{ event.title }}
            </span>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>