<script setup lang="ts">
interface InsightRun {
  id: string
  status: string
  created_at: string
  error: { code?: string; message?: string } | null
  judgment: string | null
  state_proposals: Array<{ id: string; proposal: Record<string, unknown> }>
  events: Array<{ id: string; title: string }>
  proposed_actions: Array<{ id: string; title: string; kind: string; priority: string }>
  recommendations: Array<{ id: string; type: string; content: string; priority: string }>
}

const props = defineProps<{ projectId: string; sessionId: string | null }>()

const api = useApi()

const { data, refresh } = useAsyncData(
  () => `chat-insights-${props.sessionId ?? 'none'}`,
  () =>
    props.sessionId
      ? api.get<{ items: InsightRun[] }>(
          `/projects/${props.projectId}/sessions/${props.sessionId}/runs`,
        )
      : Promise.resolve({ items: [] as InsightRun[] }),
  { watch: [() => props.sessionId] },
)

const busy = ref(false)
const error = ref('')

async function withBusy(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

function applyProposal(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${props.projectId}/state/proposals/${id}/apply`, {})
    await refresh()
  })
}

function rejectProposal(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${props.projectId}/state/proposals/${id}/reject`, {})
    await refresh()
  })
}

function confirmAction(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${props.projectId}/actions/${id}/confirm`, {})
    await refresh()
  })
}

function declineAction(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${props.projectId}/actions/${id}/decline`, {})
    await refresh()
  })
}

function acceptRecommendation(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${props.projectId}/recommendations/${id}/accept`, {
      create_action: true,
    })
    await refresh()
  })
}

function rejectRecommendation(id: string) {
  void withBusy(async () => {
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

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3 shrink-0" />

    <div class="min-h-0 flex-1 overflow-y-auto p-1">
      <p v-if="!(data?.items ?? []).length" class="text-sm text-muted">
        还没有思考结果。发送消息后,智能体会基于这轮讨论判断项目状态。
      </p>
      <div v-else class="flex flex-col gap-3">
        <UCard v-for="item in data?.items ?? []" :key="item.id" :ui="{ body: 'sm:p-3' }">
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
            <div class="flex items-center gap-1.5">
              <UButton size="xs" :disabled="busy" @click="applyProposal(proposal.id)">应用</UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="busy"
                @click="rejectProposal(proposal.id)"
              >
                忽略
              </UButton>
            </div>
          </div>

          <div
            v-for="action in item.proposed_actions"
            :key="action.id"
            class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-2"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ action.title }}</div>
              <div class="text-xs text-muted">
                {{ kindLabel(action.kind) }} · {{ priorityLabel(action.priority) }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <UButton size="xs" :disabled="busy" @click="confirmAction(action.id)">确认</UButton>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                :disabled="busy"
                @click="declineAction(action.id)"
              >
                拒绝
              </UButton>
            </div>
          </div>

          <div
            v-for="recommendation in item.recommendations"
            :key="recommendation.id"
            class="mt-2 rounded-lg border border-default p-2"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm">{{ recommendation.content }}</span>
              <div class="flex shrink-0 items-center gap-1.5">
                <UButton
                  size="xs"
                  :disabled="busy"
                  @click="acceptRecommendation(recommendation.id)"
                >
                  接受并生成行动
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="busy"
                  @click="rejectRecommendation(recommendation.id)"
                >
                  忽略
                </UButton>
              </div>
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