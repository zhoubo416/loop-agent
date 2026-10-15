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

interface DocumentItem {
  id: string
  name: string
  source: 'upload' | 'url'
  mime_type: string | null
  file_url: string | null
  file_size: number | string | null
  extracted_chars: number
  parse_status: 'pending' | 'ok' | 'unsupported' | 'failed'
  parse_error: string | null
  created_at: string
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
  documents: DocumentItem[]
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

const { data: action, refresh, pending } = await useAsyncData(
  () => `document-${actionId.value}`,
  () => api.get<ActionDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
)

const { busy, error, notice, complete, fail, cancel } = useActionLifecycle(
  projectId,
  actionId,
  refresh,
)

const summary = ref('')
const keyPoints = ref('')
const content = ref('')
const organizing = ref(false)

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))
const chatHref = computed(() => `/projects/${projectId.value}/chat?doc=${actionId.value}`)

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function submit() {
  void complete(
    { key_points: lines(keyPoints.value), content: content.value },
    summary.value || '资料已整理',
  )
}

/** AI 整理:把文档文本交给智能体生成草稿,用户检查修订后再提交 */
async function organize() {
  if (organizing.value) return
  organizing.value = true
  error.value = ''
  try {
    const draft = await api.post<{ summary: string; key_points: string[]; content: string }>(
      `/projects/${projectId.value}/actions/${actionId.value}/organize`,
      {},
    )
    summary.value = draft.summary
    keyPoints.value = draft.key_points.join('\n')
    content.value = draft.content
    notice.value = 'AI 已整理出草稿,请检查修订后再提交。'
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    organizing.value = false
  }
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

    <div v-if="pending && !action" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <USkeleton class="h-7 w-72" />
        <USkeleton class="h-6 w-48" />
      </div>
      <div class="grid gap-4 lg:grid-cols-3">
        <USkeleton class="h-72 rounded-xl lg:col-span-2" />
        <USkeleton class="h-56 rounded-xl" />
      </div>
    </div>

    <template v-else-if="action">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold">{{ action.title }}</h1>
          <p class="mt-1 text-sm text-muted">
            {{ formatDateTime(action.created_at) }} 创建 ·
            {{ executorLabel(action.executor_type) }}执行
            <template v-if="action.due_at"> · 截止 {{ formatDateTime(action.due_at) }}</template>
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <UBadge :color="kindColor(action.kind)" variant="soft">{{ kindLabel(action.kind) }}</UBadge>
          <UBadge :color="priorityColor(action.priority)" variant="soft">{{ priorityLabel(action.priority) }}</UBadge>
          <UBadge :color="statusColor(action.status)" variant="soft">{{ statusLabel(action.status) }}</UBadge>
          <UButton :to="chatHref" icon="i-lucide-message-circle" color="neutral" variant="outline" size="xs">
            去对话
          </UButton>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <ActionSource :source="action.source" />

        <ActionDocuments
          :project-id="projectId"
          :action-id="actionId"
          :documents="action.documents ?? []"
          :editable="editable"
          @refresh="refresh()"
        />

        <UCard class="lg:col-span-2">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium">{{ action.status === 'completed' ? '整理结果' : '资料内容' }}</span>
              <UButton
                v-if="editable"
                icon="i-lucide-sparkles"
                size="xs"
                color="secondary"
                variant="outline"
                :loading="organizing"
                @click="organize()"
              >
                AI 整理
              </UButton>
            </div>
          </template>

          <div v-if="editable" class="flex flex-col gap-3">
            <UFormField label="结论" help="一句话概括这份资料说明了什么,AI 整理会自动填充,可手工修订">
              <UTextarea v-model="summary" :rows="2" class="w-full" placeholder="一句话概括这份资料" />
            </UFormField>
            <UFormField label="要点" help="每行一条">
              <UTextarea v-model="keyPoints" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="内容">
              <UTextarea v-model="content" :rows="6" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton :loading="busy" @click="submit">完成并交给智能体</UButton>
              <UButton color="warning" variant="outline" :disabled="busy" @click="failWithReason">失败</UButton>
              <UButton color="error" variant="ghost" :disabled="busy" @click="cancel()">取消</UButton>
            </div>
          </div>
          <ActionResult
            v-else
            :status="action.status"
            :kind="action.kind"
            :executions="action.executions"
          />
        </UCard>

        <ExecutionList :executions="action.executions" compact />
        <ActionAnalysis :analysis="action.analysis" />
      </div>
    </template>
  </UContainer>
</template>