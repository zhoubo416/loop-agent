<script setup lang="ts">
interface ExecutionItem {
  id: string
  status: string
  executor_type: string
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  started_at: string
  completed_at: string | null
}

interface ActionDetail {
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
  executions: ExecutionItem[]
  analysis: Array<{
    id: string
    status: string
    created_at: string
    judgment: string | null
    recommendations: Array<{ id: string; type: string; content: string; priority: string; status: string }>
    events: Array<{ id: string; type: string; title: string }>
  }>
  source: {
    event: { id: string; type: string; title: string; content: string } | null
    recommendation: { id: string; content: string } | null
    run: {
      id: string
      trigger_type: string
      created_at: string
      judgment: string | null
      observation: { id: string; type: string; content: string } | null
    } | null
  } | null
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)
const actionId = computed(() => route.params.actionId as string)

const { data: action, refresh } = await useAsyncData(
  () => `meeting-${actionId.value}`,
  () => api.get<ActionDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
)

const { busy, error, notice, complete, fail, cancel } = useActionLifecycle(
  projectId,
  actionId,
  refresh,
)

const summary = ref('')
const participants = ref('')
const notes = ref('')
const decisions = ref('')
const actionItems = ref('')

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
}

function submit() {
  void complete(
    {
      participants: participants.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      notes: notes.value,
      decisions: lines(decisions.value),
      action_items: lines(actionItems.value),
    },
    summary.value || '会议已完成',
  )
}

function failWithReason() {
  const reason = window.prompt('失败原因:')
  if (reason) void fail(reason)
}
</script>

<template>
  <UContainer>
    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
    <UAlert v-if="notice" color="info" variant="soft" :title="notice" class="mb-4" />

    <template v-if="action">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold">{{ action.title }}</h1>
          <p class="mt-1 text-sm text-muted">
            {{ formatDateTime(action.created_at) }} 创建 ·
            {{ executorLabel(action.executor_type) }}执行
            <template v-if="action.due_at"> · 截止 {{ formatDateTime(action.due_at) }}</template>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UBadge :color="kindColor(action.kind)" variant="soft">{{ kindLabel(action.kind) }}</UBadge>
          <UBadge :color="priorityColor(action.priority)" variant="soft">{{ priorityLabel(action.priority) }}</UBadge>
          <UBadge :color="statusColor(action.status)" variant="soft">{{ statusLabel(action.status) }}</UBadge>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <ActionSource :source="action.source" />
        <UCard class="lg:col-span-2">
          <template #header>
            <span class="font-medium">会议记录</span>
          </template>

          <div v-if="editable" class="flex flex-col gap-4">
            <UFormField label="结论">
              <UTextarea v-model="summary" :rows="2" class="w-full" placeholder="一句话概括会议结论" />
            </UFormField>
            <UFormField label="参与人" help="用逗号分隔">
              <UInput v-model="participants" class="w-full" placeholder="张三、李四" />
            </UFormField>
            <UFormField label="纪要">
              <UTextarea v-model="notes" :rows="4" class="w-full" />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="决定" help="每行一条">
                <UTextarea v-model="decisions" :rows="3" class="w-full" />
              </UFormField>
              <UFormField label="后续行动" help="每行一条">
                <UTextarea v-model="actionItems" :rows="3" class="w-full" />
              </UFormField>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton :loading="busy" @click="submit">完成并交给智能体</UButton>
              <UButton color="warning" variant="outline" :disabled="busy" @click="failWithReason">失败</UButton>
              <UButton color="error" variant="ghost" :disabled="busy" @click="cancel()">取消</UButton>
            </div>
          </div>
          <p v-else class="text-sm text-muted">这个会议已经结束，记录见右侧执行历史。</p>
        </UCard>

        <ExecutionList :executions="action.executions" />
        <ActionAnalysis :analysis="action.analysis" />
      </div>
    </template>
  </UContainer>
</template>
