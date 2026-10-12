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
  () => `task-${actionId.value}`,
  () => api.get<ActionDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
)

const { busy, error, notice, complete, fail, cancel } = useActionLifecycle(
  projectId,
  actionId,
  refresh,
)

const summary = ref('')
const results = ref('')
const blockers = ref('')
const notes = ref('')

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function submit() {
  void complete(
    { results: lines(results.value), blockers: lines(blockers.value), notes: notes.value },
    summary.value || '任务已完成',
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
            <span class="font-medium">执行记录</span>
          </template>

          <div v-if="editable" class="flex flex-col gap-3">
            <UFormField label="结论">
              <UTextarea v-model="summary" :rows="2" class="w-full" placeholder="一句话概括执行结果" />
            </UFormField>
            <UFormField label="结果" help="每行一条">
              <UTextarea v-model="results" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="阻塞" help="每行一条,没有可留空">
              <UTextarea v-model="blockers" :rows="2" class="w-full" />
            </UFormField>
            <UFormField label="说明">
              <UTextarea v-model="notes" :rows="2" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton :loading="busy" @click="submit">完成并交给智能体</UButton>
              <UButton color="warning" variant="outline" :disabled="busy" @click="failWithReason">失败</UButton>
              <UButton color="error" variant="ghost" :disabled="busy" @click="cancel()">取消</UButton>
            </div>
          </div>
          <p v-else class="text-sm text-muted">这个任务已经结束,记录见右侧执行历史。</p>
        </UCard>

        <ExecutionList :executions="action.executions" />
        <ActionAnalysis :analysis="action.analysis" />
      </div>
    </template>
  </UContainer>
</template>
