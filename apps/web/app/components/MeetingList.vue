<script setup lang="ts">
import type { ActionListItem } from '~/composables/useActionList'
import type { MeetingImportSnapshot, TencentMeetingListItem } from '~/utils/tencentMeeting'

const props = defineProps<{ projectId: string }>()

const projectId = computed(() => props.projectId)
const api = useApi()

const { items, refresh, pending } = await useActionList(projectId, 'meeting')
const { pendingId, error, confirm, decline } = useActionOps(projectId, refresh)

type Group = 'open' | 'proposed' | 'completed' | 'all'
// 会议页首先是记录,默认展示全部,按会议时间倒序
const group = ref<Group>('all')

function inGroup(action: ActionListItem, value: Group): boolean {
  if (value === 'all') return true
  if (value === 'open') return ['pending', 'running'].includes(action.status)
  return action.status === value
}

const counts = computed(() => ({
  open: items.value.filter((item) => ['pending', 'running'].includes(item.status)).length,
  proposed: items.value.filter((item) => item.status === 'proposed').length,
  completed: items.value.filter((item) => item.status === 'completed').length,
  all: items.value.length,
}))

const groupOptions = computed(() => [
  { label: '全部', value: 'all', count: counts.value.all },
  { label: '待记录', value: 'open', count: counts.value.open },
  { label: '待确认', value: 'proposed', count: counts.value.proposed },
  { label: '已记录', value: 'completed', count: counts.value.completed },
])

function timestamp(value?: string | null): number {
  return value ? new Date(value).getTime() : 0
}

/** 有效会议时间:导入的实际开始时间 → 手填的会议时间 → 创建时间 */
function effectiveTime(action: ActionListItem): number {
  return timestamp(action.meeting?.started_at ?? action.due_at ?? action.created_at)
}

const filtered = computed(() =>
  items.value
    .filter((item) => inGroup(item, group.value))
    .sort((a, b) => effectiveTime(b) - effectiveTime(a)),
)

function meetingTimeText(action: ActionListItem): string {
  const meeting = action.meeting
  if (meeting?.started_at || meeting?.ended_at) {
    return formatMeetingRange(meeting.started_at, meeting.ended_at)
  }
  if (action.due_at) return `会议时间 ${formatDateTime(action.due_at)}`
  return `创建于 ${formatDateTime(action.created_at)}`
}

function participants(action: ActionListItem): string[] {
  const imported = action.meeting?.participants ?? []
  if (imported.length) return imported
  return action.result?.participants ?? []
}

function conclusion(action: ActionListItem): string {
  return action.meeting?.summary || action.result?.summary || ''
}

const importOpen = ref(false)
const importActionId = ref<string | null>(null)
const importNotice = ref('')

function openImport(action: ActionListItem) {
  importActionId.value = action.id
  importOpen.value = true
  importNotice.value = ''
}

function onImported(snapshot: MeetingImportSnapshot) {
  importNotice.value = `已导入「${snapshot.meeting_title ?? '腾讯会议'}」的内容。`
  void refresh()
}

const createOpen = ref(false)
const createBusy = ref(false)
const createForm = reactive({ title: '', due_at: '', description: '' })

// 新建会议时先从腾讯会议挑一场,选完再创建记录并导入
const pickerOpen = ref(false)
const creatingFromImport = ref(false)

function startPickFromTencent() {
  error.value = ''
  createOpen.value = false
  pickerOpen.value = true
}

async function importNewMeeting(meeting: TencentMeetingListItem) {
  if (creatingFromImport.value) return
  creatingFromImport.value = true
  error.value = ''
  importNotice.value = ''
  const title = meeting.title?.trim() || '腾讯会议记录'
  try {
    const created = await api.post<{ id: string }>(`/projects/${projectId.value}/actions`, {
      title,
      kind: 'meeting',
      priority: 'medium',
      due_at: meeting.started_at ?? null,
    })
    try {
      await api.post(`/projects/${projectId.value}/actions/${created.id}/meeting-import`, {
        ...(meeting.meeting_id ? { meeting_id: meeting.meeting_id } : {}),
        ...(meeting.meeting_code ? { meeting_code: meeting.meeting_code } : {}),
        ...(meeting.sub_meeting_id ? { sub_meeting_id: meeting.sub_meeting_id } : {}),
        ...(meeting.started_at ? { started_at: meeting.started_at } : {}),
        ...(meeting.ended_at ? { ended_at: meeting.ended_at } : {}),
      })
    } catch (caught) {
      // 记录已经建好,留在列表里重试导入,不把一个空记录丢给用户
      await refresh()
      error.value = `会议「${title}」已创建,但导入失败:${(caught as Error).message}。可以在列表里点「从腾讯会议导入」重试。`
      return
    }
    await navigateTo(`/projects/${projectId.value}/meetings/${created.id}`)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    creatingFromImport.value = false
  }
}

async function create() {
  if (createBusy.value) return
  if (!createForm.title.trim()) {
    error.value = '标题不能为空'
    return
  }
  createBusy.value = true
  error.value = ''
  try {
    const created = await api.post<{ id: string }>(`/projects/${projectId.value}/actions`, {
      title: createForm.title,
      kind: 'meeting',
      priority: 'medium',
      description: createForm.description || null,
      due_at: localInputToIso(createForm.due_at),
    })
    createOpen.value = false
    createForm.title = ''
    createForm.due_at = ''
    createForm.description = ''
    await navigateTo(`/projects/${projectId.value}/meetings/${created.id}`)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    createBusy.value = false
  }
}
</script>

<template>
  <UContainer>
    <div class="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">会议</h1>
        <p class="text-sm text-muted">
          记录会议结论、参与人和纪要,完成后交给智能体;内容也可以从腾讯会议直接导入。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="outline" @click="refresh()">刷新</UButton>
        <UButton @click="createOpen = true">新增会议</UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
    <UAlert v-if="importNotice" color="success" variant="soft" :title="importNotice" class="mb-4" />

    <div class="mb-3">
      <ActionStatusFilter v-model="group" :options="groupOptions" />
    </div>

    <div v-if="pending && !items.length" class="flex flex-col gap-3">
      <USkeleton v-for="n in 4" :key="n" class="h-28 rounded-lg" />
    </div>
    <div v-else class="flex flex-col gap-3">
      <UCard v-for="action in filtered" :key="action.id" :ui="{ body: 'sm:p-3' }">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <NuxtLink
            :to="actionDetailPath(projectId, action)"
            class="min-w-0 flex-1 break-words font-medium hover:underline"
          >
            {{ action.title }}
          </NuxtLink>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <UBadge v-if="action.meeting" color="secondary" variant="soft">腾讯会议</UBadge>
            <UBadge :color="statusColor(action.status)" variant="soft">
              {{ statusLabel(action.status) }}
            </UBadge>
          </div>
        </div>

        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{{ meetingTimeText(action) }}</span>
          <span v-if="action.meeting">· {{ meetingSourceLabel(action.meeting.content_source) }}</span>
        </div>

        <p v-if="participants(action).length" class="mt-1 line-clamp-1 break-words text-sm">
          <span class="text-muted">参会人:</span>{{ participants(action).join('、') }}
        </p>
        <p v-if="conclusion(action)" class="mt-1 line-clamp-2 break-words text-sm">
          <span class="text-muted">结论:</span>{{ conclusion(action) }}
        </p>
        <p
          v-else-if="action.description"
          class="mt-1 line-clamp-2 break-words text-sm text-muted"
        >
          {{ action.description }}
        </p>

        <div v-if="action.status === 'proposed'" class="mt-2 flex flex-wrap items-center gap-2">
          <UButton
            size="xs"
            :loading="pendingId === action.id"
            :disabled="pendingId !== null"
            @click="confirm(action.id)"
          >
            确认
          </UButton>
          <UButton
            size="xs"
            color="error"
            variant="ghost"
            :disabled="pendingId !== null"
            @click="decline(action.id)"
          >
            拒绝
          </UButton>
        </div>
        <div
          v-else-if="['pending', 'running'].includes(action.status)"
          class="mt-2 flex flex-wrap items-center gap-2"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :to="actionDetailPath(projectId, action)"
          >
            去记录
          </UButton>
          <UButton
            size="xs"
            color="secondary"
            variant="outline"
            icon="i-lucide-download"
            :disabled="pendingId !== null"
            @click="openImport(action)"
          >
            从腾讯会议导入
          </UButton>
        </div>
        <div v-else-if="action.status === 'completed'" class="mt-2">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :to="actionDetailPath(projectId, action)"
          >
            查看记录
          </UButton>
        </div>
      </UCard>
    </div>

    <p v-if="!pending && !filtered.length" class="mt-3 text-sm text-muted">
      这个范围内没有会议。
    </p>

    <UModal v-model:open="createOpen" title="新增会议">
      <template #body>
        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
        <div class="flex flex-col gap-4">
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-elevated/40 px-4 py-3 ring-1 ring-default"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium">会议已经开完了？</p>
              <p class="mt-0.5 text-xs text-muted">
                直接从腾讯会议导入纪要、参会人和逐字稿，不用手填。
              </p>
            </div>
            <UButton
              icon="i-lucide-download"
              color="secondary"
              variant="outline"
              :disabled="createBusy"
              @click="startPickFromTencent"
            >
              从腾讯会议导入
            </UButton>
          </div>
          <UFormField label="标题" required>
            <UInput v-model="createForm.title" class="w-full" placeholder="这场会议要讨论什么" />
          </UFormField>
          <UFormField label="会议时间">
            <UInput v-model="createForm.due_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="描述">
            <UTextarea
              v-model="createForm.description"
              :rows="3"
              class="w-full"
              placeholder="会议议题或背景,可留空"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="createOpen = false">取消</UButton>
        <UButton :loading="createBusy" @click="create">创建并记录</UButton>
      </template>
    </UModal>

    <MeetingImportModal
      v-model:open="pickerOpen"
      mode="select"
      :project-id="projectId"
      @select="importNewMeeting"
    />

    <UModal
      :open="creatingFromImport"
      title="正在从腾讯会议导入"
      :close="false"
      :dismissible="false"
    >
      <template #body>
        <div class="flex items-center gap-3 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          正在创建会议记录并读取会议内容，请稍候…
        </div>
      </template>
    </UModal>

    <MeetingImportModal
      v-if="importActionId"
      v-model:open="importOpen"
      :project-id="projectId"
      :action-id="importActionId"
      @imported="onImported"
    />
  </UContainer>
</template>
