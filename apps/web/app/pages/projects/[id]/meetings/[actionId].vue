<script setup lang="ts">
import type { MeetingImportSnapshot } from '~/utils/tencentMeeting'
import type { ActionDetailBase } from '~/utils/action'

interface MeetingDetail extends ActionDetailBase {
  meeting_import: MeetingImportSnapshot | null
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)
const actionId = computed(() => route.params.actionId as string)

const { data: action, refresh, pending, error: loadError } = await useAsyncData(
  () => `meeting-${actionId.value}`,
  () => api.get<MeetingDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
)

const {
  busy,
  error: lifecycleError,
  notice,
  complete,
  fail,
  cancel,
} = useActionLifecycle(projectId, actionId, refresh, { confirmCancel: false })

const {
  pendingId,
  error: opsError,
  confirm,
  decline,
} = useActionOps(projectId, refresh)

const pageError = computed(
  () => loadError.value?.message || lifecycleError.value || opsError.value,
)

const summary = ref('')
const participantsInput = ref('')
const notes = ref('')
const importOpen = ref(false)
const importNotice = ref('')
const failOpen = ref(false)
const cancelOpen = ref(false)
const tab = ref('record')

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))
const proposed = computed(() => action.value?.status === 'proposed')
const meetingImport = computed(() => action.value?.meeting_import ?? null)

const description = computed(() => {
  const value = action.value?.description
  return value && !isSameText(value, action.value?.title) ? value : null
})

const longDescription = computed(() => {
  const value = description.value
  return Boolean(value && (value.length > 80 || value.includes('\n')))
})

const resultParticipants = computed(() =>
  participantsFromOutput(latestCompletedOutput(action.value?.executions ?? [])),
)

const participantDraft = computed(() =>
  uniqueNames(
    participantsInput.value
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
)

/** 页头和右栏优先展示导入的参会人,其次是完成结果,最后是正在输入的内容 */
const participantList = computed(() => {
  const imported = uniqueNames(meetingImport.value?.participants ?? [])
  if (imported.length) return imported
  const completed = uniqueNames(resultParticipants.value)
  if (completed.length) return completed
  return participantDraft.value
})

function uniqueNames(names: string[]): string[] {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
}

const meetingTimeText = computed(() => {
  const snapshot = meetingImport.value
  if (snapshot?.started_at || snapshot?.ended_at) {
    return formatMeetingRange(snapshot.started_at, snapshot.ended_at)
  }
  if (action.value?.due_at) return formatDateTime(action.value.due_at)
  return ''
})

const meetingDuration = computed(() =>
  formatDuration(meetingImport.value?.started_at, meetingImport.value?.ended_at),
)

const tabs = computed(() => {
  const list = [{ label: '会议记录', value: 'record', icon: 'i-lucide-notebook-pen' }]
  const snapshot = meetingImport.value
  const hasTranscript = Boolean(snapshot?.transcript || snapshot?.transcript_segments?.length)
  const hasTodos = Boolean(snapshot?.todos?.length)
  if (snapshot && (hasTranscript || hasTodos)) {
    list.push({ label: '会议原文', value: 'transcript', icon: 'i-lucide-file-text' })
  }
  return list
})

const showTabs = computed(() => tabs.value.length > 1)

const moreActions = computed(() => [
  {
    label: '标记失败',
    icon: 'i-lucide-circle-x',
    onSelect: () => {
      failOpen.value = true
    },
  },
  {
    label: '取消会议',
    icon: 'i-lucide-ban',
    color: 'error' as const,
    onSelect: () => {
      cancelOpen.value = true
    },
  },
])

function fillForm(snapshot: MeetingImportSnapshot) {
  const nextSummary = snapshot.summary?.trim()
  if (nextSummary) summary.value = nextSummary
  const nextParticipants = snapshot.participants.join('、').trim()
  if (nextParticipants) participantsInput.value = nextParticipants
  if (snapshot.minutes?.trim()) notes.value = snapshot.minutes
}

function applyImport(snapshot: MeetingImportSnapshot) {
  fillForm(snapshot)
  importNotice.value = `已导入「${snapshot.meeting_title ?? '腾讯会议'}」的内容，请检查后完成。`
  tab.value = 'record'
  void refresh()
}

function applyStoredSnapshot() {
  if (!meetingImport.value) return
  fillForm(meetingImport.value)
  importNotice.value = '已用导入的会议内容填充表单，请检查后完成。'
}

// 从腾讯会议新建的记录一进来就把内容填好,不用再点一次按钮
const autoFilled = ref(false)
watch(
  action,
  (value) => {
    if (autoFilled.value || !value?.meeting_import) return
    if (!['pending', 'running'].includes(value.status)) return
    autoFilled.value = true
    applyStoredSnapshot()
  },
  { immediate: true },
)

function submit() {
  void complete(
    {
      participants: participantDraft.value,
      notes: notes.value,
    },
    summary.value.trim() || '会议已完成',
  )
}
</script>

<template>
  <div>
    <ActionDetailLayout
      kind="meeting"
      :loading="pending && !action"
      :title="action?.title"
      :description="description"
      :status="action?.status"
      :priority="action?.priority"
      :back-to="`/projects/${projectId}/meetings`"
      :created-at="action?.created_at"
      :completed-at="action?.completed_at"
      :error="pageError"
      :notice="notice"
    >
      <template #meta>
        <template v-if="action">
          <span v-if="meetingTimeText" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
            会议时间 {{ meetingTimeText }}
          </span>
          <span v-if="meetingDuration" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-timer" class="size-3.5" />
            {{ meetingDuration }}
          </span>
          <span v-if="participantList.length" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-users" class="size-3.5" />
            {{ participantList.length }} 位参会人
          </span>
          <span v-if="meetingImport" class="inline-flex items-center gap-1.5">
            <UBadge color="secondary" variant="soft">腾讯会议</UBadge>
            {{ meetingSourceLabel(meetingImport.content_source) }}
          </span>
        </template>
      </template>

      <template #actions>
        <template v-if="proposed">
          <UButton
            color="error"
            variant="ghost"
            :disabled="pendingId !== null"
            @click="decline(actionId)"
          >
            拒绝
          </UButton>
          <UButton
            :loading="pendingId === actionId"
            :disabled="pendingId !== null"
            @click="confirm(actionId)"
          >
            确认会议
          </UButton>
        </template>
        <UButton
          v-else-if="editable"
          icon="i-lucide-download"
          size="sm"
          color="neutral"
          variant="outline"
          @click="importOpen = true"
        >
          从腾讯会议导入
        </UButton>
      </template>

      <template #main>
        <template v-if="action">
          <div class="flex flex-col gap-4">
            <UTabs
              v-if="showTabs"
              v-model="tab"
              :items="tabs"
              variant="link"
              :content="false"
            />

            <template v-if="tab === 'record' || !showTabs">
              <ActionPanel
                v-if="description && longDescription"
                title="会议说明"
                icon="i-lucide-align-left"
              >
                <p class="break-words whitespace-pre-wrap text-sm leading-7 text-default">
                  {{ description }}
                </p>
              </ActionPanel>

              <ActionPanel
                v-if="proposed"
                title="等待确认"
                icon="i-lucide-clock"
                description="这是智能体提议的会议记录，确认后才进入待记录。"
              >
                <p class="text-sm leading-relaxed text-muted">
                  确认后可以导入腾讯会议内容或手工记录；拒绝后这场会议不会再出现在待记录列表里。
                </p>
              </ActionPanel>

              <ActionPanel
                v-else-if="editable"
                title="会议记录"
                icon="i-lucide-notebook-pen"
                description="记录会议结论、参与人和纪要，完成后交给智能体。"
              >
                <div class="flex flex-col gap-5">
                  <UAlert
                    v-if="importNotice"
                    color="info"
                    variant="soft"
                    icon="i-lucide-download"
                    :title="importNotice"
                  />

                  <div
                    v-if="meetingImport"
                    class="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-primary/5 px-4 py-3 ring-1 ring-primary/15"
                  >
                    <div class="flex min-w-0 items-start gap-3">
                      <div
                        class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      >
                        <UIcon name="i-lucide-video" class="size-4" />
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium">
                          已导入「{{ meetingImport.meeting_title ?? '腾讯会议' }}」
                        </p>
                        <p class="mt-0.5 text-xs text-muted">
                          {{ formatMeetingRange(meetingImport.started_at, meetingImport.ended_at) }}
                          · {{ meetingSourceLabel(meetingImport.content_source) }}
                        </p>
                      </div>
                    </div>
                    <UButton size="xs" color="primary" variant="soft" @click="applyStoredSnapshot">
                      用这份内容填充表单
                    </UButton>
                  </div>

                  <UFormField label="结论" help="一句话概括会议结论">
                    <UTextarea
                      v-model="summary"
                      :rows="3"
                      :maxrows="6"
                      autoresize
                      class="w-full"
                      placeholder="这次会议得出了什么结论"
                    />
                  </UFormField>

                  <UFormField label="参与人" help="用逗号或顿号分隔">
                    <UInput
                      v-model="participantsInput"
                      icon="i-lucide-users"
                      class="w-full"
                      placeholder="张三、李四"
                    />
                    <div v-if="participantDraft.length" class="mt-2 flex flex-wrap gap-1.5">
                      <span
                        v-for="name in participantDraft"
                        :key="name"
                        class="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-xs text-default"
                      >
                        <UAvatar :text="name.slice(0, 1)" :alt="name" size="3xs" />
                        {{ name }}
                      </span>
                    </div>
                  </UFormField>

                  <UFormField label="纪要">
                    <UTextarea
                      v-model="notes"
                      :rows="8"
                      :maxrows="18"
                      autoresize
                      class="w-full"
                      placeholder="会议过程、决定和后续行动"
                    />
                  </UFormField>
                </div>

                <template #footer>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <UDropdownMenu :items="moreActions">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        trailing-icon="i-lucide-chevron-down"
                        :disabled="busy"
                      >
                        更多
                      </UButton>
                    </UDropdownMenu>
                    <UButton :loading="busy" @click="submit">完成并交给智能体</UButton>
                  </div>
                </template>
              </ActionPanel>

              <ActionPanel
                v-else
                :title="action.status === 'completed' ? '会议结果' : '会议状态'"
                icon="i-lucide-clipboard-check"
              >
                <ActionResult
                  :status="action.status"
                  kind="meeting"
                  :executions="action.executions"
                  summary-label="结论"
                />
              </ActionPanel>
            </template>

            <MeetingImportSnapshotView v-else-if="meetingImport" :snapshot="meetingImport" />
          </div>
        </template>
      </template>

      <template #rail>
        <ActionContextRail
          v-if="action"
          :analysis="action.analysis"
          :executions="action.executions"
          :source="action.source"
          :title="action.title"
          :description="action.description"
          :participants="participantList"
          details-title="会议信息"
          source-heading="为什么有这个会议"
          source-hint="智能体当时看到的内容，以及它决定提出这个会议的原因。"
        >
          <template #details>
            <ActionProperty label="状态">
              <UBadge :color="statusColor(action.status)" variant="soft">
                {{ statusLabel(action.status) }}
              </UBadge>
            </ActionProperty>
            <ActionProperty label="优先级">
              <span class="inline-flex items-center gap-1">
                <UIcon name="i-lucide-flag" class="size-3.5" />
                {{ priorityLabel(action.priority) }}
              </span>
            </ActionProperty>
            <ActionProperty v-if="meetingTimeText" label="会议时间">
              {{ meetingTimeText }}
            </ActionProperty>
            <ActionProperty v-if="meetingDuration" label="时长">
              {{ meetingDuration }}
            </ActionProperty>
            <ActionProperty v-if="meetingImport?.meeting_code" label="会议号">
              {{ meetingImport.meeting_code }}
            </ActionProperty>
            <ActionProperty v-if="meetingImport" label="纪要来源">
              {{ meetingSourceLabel(meetingImport.content_source) }}
            </ActionProperty>
            <ActionProperty label="执行者">{{ executorLabel(action.executor_type) }}</ActionProperty>
            <ActionProperty label="创建时间">{{ formatDateTime(action.created_at) }}</ActionProperty>
            <ActionProperty v-if="action.completed_at" label="完成时间">
              {{ formatDateTime(action.completed_at) }}
            </ActionProperty>
          </template>
        </ActionContextRail>
      </template>
    </ActionDetailLayout>

    <MeetingImportModal
      v-model:open="importOpen"
      :project-id="projectId"
      :action-id="actionId"
      @imported="applyImport"
    />

    <ActionReasonModal
      v-model:open="failOpen"
      title="标记会议失败"
      description="失败原因会交给智能体，它会据此调整下一步。"
      placeholder="比如:会议临时取消，无法记录"
      confirm-label="标记失败"
      confirm-color="warning"
      :busy="busy"
      @confirm="(reason) => fail(reason)"
    />

    <ActionReasonModal
      v-model:open="cancelOpen"
      title="取消会议"
      description="取消原因可留空。取消后这场会议不会再出现在待记录的列表里，智能体也会收到通知。"
      placeholder="比如:会议不再需要记录"
      confirm-label="取消会议"
      confirm-color="error"
      :require-reason="false"
      :busy="busy"
      @confirm="(reason) => cancel(reason || undefined)"
    />
  </div>
</template>
