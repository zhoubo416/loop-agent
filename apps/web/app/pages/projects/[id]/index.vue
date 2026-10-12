<script setup lang="ts">
interface Overview {
  project: { id: string; name: string; objective: string; status: string }
  state: { current_stage: string | null; current_situation: string | null; version: number }
  open_issues: Array<string | { title?: string }>
  risks: Array<string | { title?: string }>
  active_actions: Array<{ id: string; title: string; kind: string; priority: string; status: string }>
  recommendations: Array<{ id: string; type: string; content: string; priority: string }>
  proposed_actions: Array<{ id: string; title: string; kind: string; priority: string }>
  state_proposals: Array<{ id: string; proposal: Record<string, unknown> }>
  recent_activity: Array<{ id: string; type: string; title: string; created_at: string }>
}

const route = useRoute()
const api = useApi()
const { waitForRun } = useRunWaiter()
const projectId = computed(() => route.params.id as string)

const { data, refresh, error } = await useAsyncData(
  () => `overview-${projectId.value}`,
  () => api.get<Overview>(`/projects/${projectId.value}/overview`),
)

const busy = ref(false)
const agentStatus = ref('')
const actionError = ref('')

function label(issue: string | { title?: string }): string {
  return typeof issue === 'string' ? issue : (issue.title ?? JSON.stringify(issue))
}

function proposalSummary(proposal: Record<string, unknown>): string[] {
  const parts: string[] = []
  if (proposal.currentStage) parts.push(`阶段 → ${proposal.currentStage}`)
  const issues = proposal.openIssues
  if (Array.isArray(issues) && issues.length) {
    parts.push(`开放问题 +${issues.length}`)
  }
  if (Array.isArray(proposal.risks) && proposal.risks.length) {
    parts.push(`风险 +${proposal.risks.length}`)
  }
  if (Array.isArray(proposal.unknowns) && proposal.unknowns.length) {
    parts.push(`未知项 +${proposal.unknowns.length}`)
  }
  return parts.length ? parts : ['状态变更']
}

async function withBusy(fn: () => Promise<void>) {
  busy.value = true
  actionError.value = ''
  try {
    await fn()
  } catch (caught) {
    actionError.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

function wakeAgent() {
  void withBusy(async () => {
    agentStatus.value = '智能体正在运行…'
    const run = await api.post<{ id: string }>(`/projects/${projectId.value}/runs`, {
      trigger_type: 'manual',
      instruction: '检查当前项目状态。',
    })
    const finished = await waitForRun(projectId.value, run.id)
    agentStatus.value =
      finished?.status === 'completed'
        ? '智能体已完成一次运行。'
        : finished?.status === 'failed'
          ? `智能体运行失败:${finished.error?.message ?? '未知原因'}`
          : '智能体运行超时,请稍后刷新。'
    await refresh()
  })
}

function acceptRecommendation(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/recommendations/${id}/accept`, {
      create_action: true,
    })
    await refresh()
  })
}

function rejectRecommendation(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/recommendations/${id}/reject`, {})
    await refresh()
  })
}

function confirmAction(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/actions/${id}/confirm`, {})
    await refresh()
  })
}

function declineAction(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/actions/${id}/decline`, {})
    await refresh()
  })
}

function applyProposal(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/state/proposals/${id}/apply`, {})
    await refresh()
  })
}

function rejectProposal(id: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/state/proposals/${id}/reject`, {})
    await refresh()
  })
}

function confirmCompletion(recommendationId: string) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/completion/confirm`, {
      recommendation_id: recommendationId,
    })
    await refresh()
  })
}

</script>

<template>
  <UContainer>
    <UAlert v-if="error" color="error" variant="soft" :title="error.message" class="mb-4" />
    <UAlert v-if="actionError" color="error" variant="soft" :title="actionError" class="mb-4" />

    <template v-if="data">
      <div class="mb-6 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold">{{ data.project.name }}</h1>
          <p class="text-muted">{{ data.project.objective }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UBadge :color="statusColor(data.project.status)" variant="soft">
            {{ statusLabel(data.project.status) }}
          </UBadge>
          <UButton :loading="busy" @click="wakeAgent">让智能体运行一次</UButton>
        </div>
      </div>

      <UAlert v-if="agentStatus" class="mb-4" color="info" variant="soft" :title="agentStatus" />

      <UCard class="mb-4">
        <template #header>
          <span class="font-medium">当前状态</span>
        </template>
        <p class="mb-2">
          {{ data.state.current_situation || '智能体还没有形成对项目现状的判断。' }}
        </p>
        <p class="text-sm text-muted">
          当前阶段:{{ data.state.current_stage || '未开始' }} · 状态 v{{ data.state.version }}
        </p>
      </UCard>

      <UCard v-if="data.state_proposals.length" class="mb-4">
        <template #header>
          <span class="font-medium">待确认的状态变更</span>
        </template>
        <div class="flex flex-col gap-3">
          <div
            v-for="proposal in data.state_proposals"
            :key="proposal.id"
            class="flex flex-wrap items-center justify-between gap-3"
          >
            <span>{{ proposalSummary(proposal.proposal).join(',') }}</span>
            <div class="flex items-center gap-2">
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
        </div>
      </UCard>

      <div class="mb-4 grid gap-4 md:grid-cols-2">
        <UCard>
          <template #header>
            <span class="font-medium">开放问题</span>
          </template>
          <ul v-if="data.open_issues.length" class="flex list-disc flex-col gap-1 pl-5">
            <li v-for="(issue, index) in data.open_issues" :key="index">{{ label(issue) }}</li>
          </ul>
          <p v-else class="text-sm text-muted">当前没有开放问题。</p>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-medium">智能体建议</span>
          </template>
          <div v-if="data.recommendations.length" class="flex flex-col gap-4">
            <div
              v-for="item in data.recommendations"
              :key="item.id"
              class="flex flex-col gap-3 border-b border-default pb-3 last:border-0 last:pb-0"
            >
              <span>{{ item.content }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <UBadge :color="priorityColor(item.priority)" variant="soft">
                  {{ item.priority }}
                </UBadge>
                <template v-if="item.type === 'completion'">
                  <UButton size="xs" :disabled="busy" @click="confirmCompletion(item.id)">
                    确认完成项目
                  </UButton>
                </template>
                <template v-else>
                  <UButton size="xs" :disabled="busy" @click="acceptRecommendation(item.id)">
                    接受并生成行动
                  </UButton>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="busy"
                    @click="rejectRecommendation(item.id)"
                  >
                    忽略
                  </UButton>
                </template>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-muted">智能体暂时没有新的建议。</p>
        </UCard>
      </div>

      <UCard v-if="data.proposed_actions.length" class="mb-4">
        <template #header>
          <span class="font-medium">待确认的行动</span>
        </template>
        <div class="flex flex-col gap-3">
          <div
            v-for="action in data.proposed_actions"
            :key="action.id"
            class="flex flex-wrap items-center justify-between gap-3"
          >
            <NuxtLink
              :to="actionDetailPath(projectId, action)"
              class="font-medium hover:underline"
            >
              {{ action.title }}
            </NuxtLink>
            <div class="flex items-center gap-2">
              <UBadge :color="kindColor(action.kind)" variant="subtle">{{ kindLabel(action.kind) }}</UBadge>
              <UBadge :color="priorityColor(action.priority)" variant="soft">
                {{ priorityLabel(action.priority) }}
              </UBadge>
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
        </div>
      </UCard>

      <UCard class="mb-4">
        <template #header>
          <span class="font-medium">进行中的行动</span>
        </template>
        <div v-if="data.active_actions.length" class="flex flex-col gap-3">
          <div
            v-for="action in data.active_actions"
            :key="action.id"
            class="flex flex-wrap items-center justify-between gap-3"
          >
            <NuxtLink
              :to="actionDetailPath(projectId, action)"
              class="font-medium hover:underline"
            >
              {{ action.title }}
            </NuxtLink>
            <div class="flex items-center gap-2">
              <UBadge :color="priorityColor(action.priority)" variant="soft">
                {{ priorityLabel(action.priority) }}
              </UBadge>
              <UBadge :color="kindColor(action.kind)" variant="subtle">{{ kindLabel(action.kind) }}</UBadge>
              <UBadge :color="statusColor(action.status)" variant="soft">
                {{ statusLabel(action.status) }}
              </UBadge>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                :to="actionDetailPath(projectId, action)"
              >
                处理
              </UButton>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-muted">当前没有进行中的行动。</p>
      </UCard>

      <UCard>
        <template #header>
          <span class="font-medium">近期动态</span>
        </template>
        <div v-if="data.recent_activity.length" class="flex flex-col gap-3">
          <div
            v-for="item in data.recent_activity"
            :key="`${item.type}-${item.id}`"
            class="lo-timeline-row border-b border-default pb-3 last:border-0 last:pb-0"
          >
            <span class="text-xs text-muted">{{ formatDateTime(item.created_at) }}</span>
            <span class="text-xs text-muted">{{ timelineTypeLabels[item.type] ?? item.type }}</span>
            <span>{{ item.title }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-muted">还没有活动记录。</p>
      </UCard>

    </template>
  </UContainer>
</template>
