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
  meeting_sync: MeetingSync | null
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

interface MeetingTranscriptSegment {
  speaker: string | null
  start_at: string | null
  end_at: string | null
  text: string
}

interface MeetingSync {
  id: string
  action_id: string
  meeting_code: string
  meeting_id: string | null
  record_file_id: string | null
  meeting_title: string | null
  started_at: string | null
  ended_at: string | null
  participants: string[]
  summary: string | null
  todo: string | null
  transcript: string | null
  transcript_segments: MeetingTranscriptSegment[]
  synced_at: string
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
const meetingCode = ref('')
const tencentToken = ref('')
const tokenConfigured = ref(false)
const tokenPanelOpen = ref(false)
const showTranscript = ref(false)
const syncBusy = ref(false)
const syncError = ref('')
const syncNotice = ref('')

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))
const meetingSync = computed(() => action.value?.meeting_sync ?? null)

const { data: integration } = await useAsyncData(
  'tencent-meeting-integration',
  () => api.get<{ configured: boolean }>('/me/integrations/tencent-meeting'),
)

watch(
  () => integration.value?.configured,
  (configured) => {
    tokenConfigured.value = configured ?? false
  },
  { immediate: true },
)

watch(
  meetingSync,
  (synced) => {
    if (!synced) return
    meetingCode.value = synced.meeting_code
    participants.value = synced.participants.join('、')
    notes.value = synced.summary ?? ''
    actionItems.value = synced.todo ?? ''
  },
  { immediate: true },
)

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
}

function formatTranscriptSegment(segment: MeetingTranscriptSegment): string {
  const time = segment.start_at ? formatDateTime(segment.start_at) : ''
  const speaker = segment.speaker ? `${segment.speaker}：` : ''
  return `${time ? `${time} ` : ''}${speaker}${segment.text}`
}

async function saveTencentToken() {
  if (syncBusy.value) return
  if (!tencentToken.value.trim()) {
    syncError.value = '请输入腾讯会议 Token'
    return
  }
  syncBusy.value = true
  syncError.value = ''
  syncNotice.value = ''
  try {
    await api.put('/me/integrations/tencent-meeting', { token: tencentToken.value })
    tokenConfigured.value = true
    tencentToken.value = ''
    tokenPanelOpen.value = false
    syncNotice.value = '腾讯会议已连接，Token 只保存在服务端。'
  } catch (caught) {
    syncError.value = (caught as Error).message
  } finally {
    syncBusy.value = false
  }
}

async function syncMeeting() {
  if (syncBusy.value) return
  if (!/^\d{9}$/.test(meetingCode.value)) {
    syncError.value = '请输入 9 位腾讯会议号'
    return
  }
  if (!tokenConfigured.value) {
    tokenPanelOpen.value = true
    syncError.value = '请先配置腾讯会议 Token'
    return
  }
  syncBusy.value = true
  syncError.value = ''
  syncNotice.value = ''
  try {
    await api.post(`/projects/${projectId.value}/actions/${actionId.value}/meeting-sync`, {
      meeting_code: meetingCode.value,
    })
    await refresh()
    syncNotice.value = '腾讯会议内容已同步，可以检查并编辑会议记录。'
  } catch (caught) {
    syncError.value = (caught as Error).message
  } finally {
    syncBusy.value = false
  }
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
            <UAlert v-if="syncError" color="error" variant="soft" :title="syncError" />
            <UAlert v-if="syncNotice" color="info" variant="soft" :title="syncNotice" />

            <div class="rounded-lg border border-default p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-medium">同步腾讯会议</p>
                  <p class="text-sm text-muted">输入 9 位会议号，读取会后纪要、参会人和逐字稿。</p>
                </div>
                <UBadge :color="tokenConfigured ? 'success' : 'neutral'" variant="soft">
                  {{ tokenConfigured ? '已连接' : '未连接' }}
                </UBadge>
              </div>
              <div class="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <UFormField label="腾讯会议号" help="会议结束后请等待录制和转写生成">
                  <UInput v-model="meetingCode" class="w-full" inputmode="numeric" maxlength="9" placeholder="123456789" />
                </UFormField>
                <UButton :loading="syncBusy" :disabled="!tokenConfigured" @click="syncMeeting">
                  同步腾讯会议
                </UButton>
              </div>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                class="mt-2"
                @click="tokenPanelOpen = !tokenPanelOpen"
              >
                {{ tokenConfigured ? '更新 Token' : '配置 Token' }}
              </UButton>
              <div v-if="tokenPanelOpen" class="mt-3 flex flex-col gap-2">
                <UInput
                  v-model="tencentToken"
                  type="password"
                  autocomplete="off"
                  class="w-full"
                  placeholder="粘贴腾讯会议 AI Skill Token"
                />
                <div class="flex flex-wrap items-center gap-2">
                  <UButton size="xs" :loading="syncBusy" @click="saveTencentToken">保存连接</UButton>
                  <span class="text-xs text-muted">Token 不会返回浏览器，也不会写入日志。</span>
                </div>
              </div>
            </div>

            <UCard v-if="meetingSync" variant="subtle">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-medium">已同步：{{ meetingSync.meeting_title || meetingSync.meeting_code }}</p>
                  <p class="text-xs text-muted">同步于 {{ formatDateTime(meetingSync.synced_at) }}</p>
                </div>
                <UBadge v-if="meetingSync.record_file_id" color="success" variant="soft">已获取录制</UBadge>
              </div>
              <div class="mt-3 flex flex-col gap-2 text-sm">
                <p><span class="text-muted">参会人：</span>{{ meetingSync.participants.join('、') || '未获取到' }}</p>
                <p><span class="text-muted">会议纪要：</span>{{ meetingSync.summary || '未生成' }}</p>
                <p><span class="text-muted">会议待办：</span>{{ meetingSync.todo || '未生成' }}</p>
              </div>
              <UButton
                v-if="meetingSync.transcript_segments.length"
                size="xs"
                color="neutral"
                variant="ghost"
                class="mt-3"
                @click="showTranscript = !showTranscript"
              >
                {{ showTranscript ? '收起逐字稿' : `查看逐字稿（${meetingSync.transcript_segments.length} 段）` }}
              </UButton>
              <div v-if="showTranscript" class="mt-3 max-h-96 overflow-y-auto rounded-md border border-default p-3">
                <p
                  v-for="(segment, index) in meetingSync.transcript_segments"
                  :key="`${segment.start_at ?? 'segment'}-${index}`"
                  class="whitespace-pre-wrap border-b border-default py-2 text-sm last:border-b-0"
                >
                  {{ formatTranscriptSegment(segment) }}
                </p>
              </div>
            </UCard>

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
          <div v-else class="flex flex-col gap-3">
            <p class="text-sm text-muted">这个会议已经结束，会议记录和逐字稿保留在下方。</p>
            <UCard v-if="meetingSync" variant="subtle">
              <p class="font-medium">{{ meetingSync.meeting_title || meetingSync.meeting_code }}</p>
              <p class="mt-2 text-sm"><span class="text-muted">参会人：</span>{{ meetingSync.participants.join('、') || '未获取到' }}</p>
              <p class="mt-2 whitespace-pre-wrap text-sm text-muted">{{ meetingSync.summary || '未生成智能纪要' }}</p>
              <p class="mt-3 whitespace-pre-wrap text-sm text-muted">{{ meetingSync.todo || '未生成会议待办' }}</p>
              <p v-if="meetingSync.transcript" class="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-default pt-3 text-sm">
                {{ meetingSync.transcript }}
              </p>
            </UCard>
          </div>
        </UCard>

        <ExecutionList :executions="action.executions" />
        <ActionAnalysis :analysis="action.analysis" />
      </div>
    </template>
  </UContainer>
</template>
