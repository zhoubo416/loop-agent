<script setup lang="ts">
import type {
  MeetingImportSnapshot,
  TencentMeetingIntegrationStatus,
  TencentMeetingListItem,
  TencentMeetingListResponse,
} from '~/utils/tencentMeeting'

const props = defineProps<{
  projectId: string
  actionId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  imported: [snapshot: MeetingImportSnapshot]
}>()

const api = useApi()

const integration = ref<TencentMeetingIntegrationStatus | null>(null)
const statusPending = ref(false)
const statusError = ref('')
const forceRebind = ref(false)

const fromDate = ref('')
const toDate = ref('')
const meetings = ref<TencentMeetingListItem[]>([])
const meetingsPending = ref(false)
const meetingsError = ref('')
const nextPageToken = ref<string | null>(null)
const hasMore = ref(false)

const readingKey = ref<string | null>(null)
const preview = ref<MeetingImportSnapshot | null>(null)
const previewError = ref('')
const showTranscript = ref(false)

function dateInput(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date)
}

function resetRange() {
  const now = new Date()
  toDate.value = dateInput(now)
  fromDate.value = dateInput(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
}

function rangeIso(date: string, endOfDay: boolean): string {
  return `${date}T${endOfDay ? '23:59:59' : '00:00:00'}+08:00`
}

/** 周期会议的多个实例可能共用 meeting_id,key 里要带上实例信息 */
function meetingKey(meeting: TencentMeetingListItem): string {
  return [
    meeting.meeting_id ?? meeting.meeting_code ?? 'meeting',
    meeting.sub_meeting_id ?? '',
    meeting.started_at ?? '',
    meeting.title,
  ].join('|')
}

function meetingIdentifier(meeting: TencentMeetingListItem): string | null {
  return meeting.meeting_id ?? meeting.meeting_code
}

function handleIntegrationError(message: string) {
  if (!message.includes('绑定')) return
  forceRebind.value = true
  integration.value = { configured: false, masked_token: null, updated_at: null }
  preview.value = null
}

async function loadStatus() {
  statusPending.value = true
  statusError.value = ''
  try {
    integration.value = await api.get<TencentMeetingIntegrationStatus>(
      '/me/integrations/tencent-meeting',
    )
    if (integration.value.configured) await loadMeetings(true)
  } catch (caught) {
    statusError.value = (caught as Error).message
  } finally {
    statusPending.value = false
  }
}

async function loadMeetings(reset: boolean) {
  if (!fromDate.value || !toDate.value) {
    meetingsError.value = '请选择时间范围'
    return
  }
  meetingsPending.value = true
  meetingsError.value = ''
  if (reset) {
    meetings.value = []
    nextPageToken.value = null
    hasMore.value = false
    preview.value = null
    previewError.value = ''
  }
  try {
    const params = new URLSearchParams({
      from: rangeIso(fromDate.value, false),
      to: rangeIso(toDate.value, true),
    })
    if (!reset && nextPageToken.value) params.set('page_token', nextPageToken.value)
    const result = await api.get<TencentMeetingListResponse>(
      `/me/integrations/tencent-meeting/meetings?${params.toString()}`,
    )
    meetings.value = reset ? result.items : [...meetings.value, ...result.items]
    hasMore.value = result.has_more
    nextPageToken.value = result.next_page_token
  } catch (caught) {
    const message = (caught as Error).message
    meetingsError.value = message
    handleIntegrationError(message)
  } finally {
    meetingsPending.value = false
  }
}

async function readMeeting(meeting: TencentMeetingListItem) {
  if (readingKey.value) return
  const identifier = meetingIdentifier(meeting)
  if (!identifier) return
  readingKey.value = meetingKey(meeting)
  previewError.value = ''
  preview.value = null
  showTranscript.value = false
  try {
    const result = await api.post<{ meeting_import: MeetingImportSnapshot }>(
      `/projects/${props.projectId}/actions/${props.actionId}/meeting-import`,
      {
        ...(meeting.meeting_id ? { meeting_id: meeting.meeting_id } : {}),
        ...(meeting.meeting_code ? { meeting_code: meeting.meeting_code } : {}),
        ...(meeting.sub_meeting_id ? { sub_meeting_id: meeting.sub_meeting_id } : {}),
        ...(meeting.started_at ? { started_at: meeting.started_at } : {}),
        ...(meeting.ended_at ? { ended_at: meeting.ended_at } : {}),
      },
    )
    preview.value = result.meeting_import
  } catch (caught) {
    const message = (caught as Error).message
    previewError.value = message
    handleIntegrationError(message)
  } finally {
    readingKey.value = null
  }
}

function onBound(status: TencentMeetingIntegrationStatus) {
  forceRebind.value = false
  integration.value = status
  meetingsError.value = ''
  void loadMeetings(true)
}

function confirmImport() {
  if (!preview.value) return
  emit('imported', preview.value)
  open.value = false
}

watch(open, (value) => {
  if (!value) return
  resetRange()
  preview.value = null
  previewError.value = ''
  showTranscript.value = false
  forceRebind.value = false
  void loadStatus()
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="从腾讯会议导入"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <div v-if="statusPending" class="flex flex-col gap-3">
          <USkeleton class="h-10 rounded-lg" />
          <USkeleton class="h-44 rounded-lg" />
        </div>

        <template v-else>
          <UAlert v-if="statusError" color="error" variant="soft" :title="statusError" />
          <UAlert v-if="meetingsError" color="error" variant="soft" :title="meetingsError" />

          <TencentMeetingBinding
            v-if="!integration?.configured"
            compact
            :force-form="forceRebind"
            @bound="onBound"
            @cancel="forceRebind = false"
          />

          <template v-else>
            <div class="flex flex-wrap items-end gap-2">
              <UFormField label="从">
                <UInput v-model="fromDate" type="date" class="w-40" />
              </UFormField>
              <UFormField label="到">
                <UInput v-model="toDate" type="date" class="w-40" />
              </UFormField>
              <UButton :loading="meetingsPending" :disabled="meetingsPending" @click="loadMeetings(true)">
                查询
              </UButton>
            </div>

            <UAlert v-if="previewError" color="error" variant="soft" :title="previewError" />

            <div v-if="meetingsPending && !meetings.length" class="flex flex-col gap-2">
              <USkeleton v-for="n in 3" :key="n" class="h-14 rounded-lg" />
            </div>
            <p v-else-if="!meetings.length" class="text-sm text-muted">
              这段时间没有已结束的会议。
            </p>
            <div v-else class="flex max-h-64 flex-col gap-2 overflow-y-auto">
              <UButton
                v-for="meeting in meetings"
                :key="meetingKey(meeting)"
                color="neutral"
                variant="outline"
                block
                class="justify-start py-3 text-left"
                :loading="readingKey === meetingKey(meeting)"
                :disabled="readingKey !== null || !meetingIdentifier(meeting)"
                @click="readMeeting(meeting)"
              >
                <span class="flex min-w-0 flex-col items-start">
                  <span class="w-full truncate font-medium">{{ meeting.title }}</span>
                  <span class="text-xs font-normal text-muted">
                    {{ formatMeetingRange(meeting.started_at, meeting.ended_at) }}
                    <template v-if="meeting.meeting_code"> · {{ meeting.meeting_code }}</template>
                  </span>
                </span>
              </UButton>
              <UButton
                v-if="hasMore"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="meetingsPending"
                @click="loadMeetings(false)"
              >
                加载更多
              </UButton>
            </div>

            <div v-if="preview" class="rounded-lg border border-default p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p class="font-medium">{{ preview.meeting_title ?? '未命名会议' }}</p>
                  <p class="text-xs text-muted">
                    {{ formatMeetingRange(preview.started_at, preview.ended_at) }}
                  </p>
                </div>
                <UBadge color="neutral" variant="soft">
                  {{ meetingSourceLabel(preview.content_source) }}
                </UBadge>
              </div>

              <div class="mt-3 flex flex-col gap-3 text-sm">
                <p v-if="preview.summary">
                  <span class="text-muted">结论：</span>{{ preview.summary }}
                </p>
                <p v-if="preview.participants.length">
                  <span class="text-muted">参会人：</span>{{ preview.participants.join('、') }}
                </p>
                <div v-if="preview.minutes">
                  <p class="text-xs font-medium text-muted">纪要</p>
                  <p class="mt-0.5 whitespace-pre-wrap">{{ preview.minutes }}</p>
                </div>
                <p v-else class="text-sm text-muted">这场会议没有可用的 AI 纪要，导入后请手工填写。</p>
                <div v-if="preview.transcript">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="showTranscript ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    @click="showTranscript = !showTranscript"
                  >
                    {{ showTranscript ? '收起逐字稿' : '查看逐字稿' }}
                  </UButton>
                  <p class="text-xs text-muted">逐字稿只保存在 LOOP，不交给智能体。</p>
                  <div
                    v-if="showTranscript"
                    class="mt-1 max-h-64 overflow-y-auto rounded-lg bg-elevated/40 p-2 text-xs whitespace-pre-wrap"
                  >
                    {{ preview.transcript }}
                  </div>
                </div>
                <p v-else class="text-sm text-muted">这场会议没有可用的逐字稿。</p>
              </div>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="open = false">关闭</UButton>
      <UButton v-if="preview" @click="confirmImport">导入到会议记录</UButton>
    </template>
  </UModal>
</template>
