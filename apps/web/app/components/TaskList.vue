<script setup lang="ts">
import type { ActionListItem } from '~/composables/useActionList'

const props = defineProps<{ projectId: string }>()

const projectId = computed(() => props.projectId)
const api = useApi()

const { items, userOptions, refresh, pending } = await useActionList(projectId, 'task')
const { pendingId, error, assign, confirm, decline } = useActionOps(projectId, refresh)

type Group = 'active' | 'proposed' | 'completed' | 'all'
const group = ref<Group>('active')
const assigneeFilter = ref('all')

const assigneeOptions = computed(() => [
  { label: '全部负责人', value: 'all' },
  { label: '未指派', value: 'unassigned' },
  ...userOptions.value,
])

function inGroup(action: ActionListItem, value: Group): boolean {
  if (value === 'all') return true
  if (value === 'active') return ['pending', 'running'].includes(action.status)
  return action.status === value
}

const counts = computed(() => ({
  active: items.value.filter((item) => ['pending', 'running'].includes(item.status)).length,
  proposed: items.value.filter((item) => item.status === 'proposed').length,
  completed: items.value.filter((item) => item.status === 'completed').length,
  all: items.value.length,
}))

const groupOptions = computed(() => [
  { label: '进行中', value: 'active', count: counts.value.active },
  { label: '待确认', value: 'proposed', count: counts.value.proposed },
  { label: '已完成', value: 'completed', count: counts.value.completed },
  { label: '全部', value: 'all', count: counts.value.all },
])

const priorityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
const statusRank: Record<string, number> = { running: 0, pending: 1, proposed: 2 }

function timestamp(value?: string | null): number {
  return value ? new Date(value).getTime() : 0
}

const filtered = computed(() => {
  const list = items.value.filter((item) => {
    if (!inGroup(item, group.value)) return false
    if (assigneeFilter.value === 'all') return true
    if (assigneeFilter.value === 'unassigned') return !item.assignee_id
    return item.assignee_id === assigneeFilter.value
  })
  return [...list].sort((a, b) => {
    if (group.value === 'completed') {
      return timestamp(b.completed_at ?? b.created_at) - timestamp(a.completed_at ?? a.created_at)
    }
    const statusDiff = (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3)
    if (statusDiff) return statusDiff
    // 进行中按截止时间从近到远,没有截止时间的排在后面
    const dueA = a.due_at ? timestamp(a.due_at) : Number.MAX_SAFE_INTEGER
    const dueB = b.due_at ? timestamp(b.due_at) : Number.MAX_SAFE_INTEGER
    if (dueA !== dueB) return dueA - dueB
    const priorityDiff = (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0)
    if (priorityDiff) return priorityDiff
    return timestamp(b.created_at) - timestamp(a.created_at)
  })
})

function isOverdue(action: ActionListItem): boolean {
  return (
    Boolean(action.due_at) &&
    ['pending', 'running'].includes(action.status) &&
    timestamp(action.due_at) < Date.now()
  )
}

function assigneeName(id: string | null): string {
  if (!id) return '未指派'
  return userOptions.value.find((option) => option.value === id)?.label ?? '未指派'
}

const createOpen = ref(false)
const createBusy = ref(false)
const createForm = reactive({
  title: '',
  priority: 'medium',
  assignee_id: '',
  due_at: '',
  description: '',
})

const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '严重', value: 'critical' },
]

function resetForm() {
  createForm.title = ''
  createForm.priority = 'medium'
  createForm.assignee_id = ''
  createForm.due_at = ''
  createForm.description = ''
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
    await api.post(`/projects/${projectId.value}/actions`, {
      title: createForm.title,
      kind: 'task',
      priority: createForm.priority,
      description: createForm.description || null,
      assignee_id: createForm.assignee_id || null,
      due_at: localInputToIso(createForm.due_at),
    })
    createOpen.value = false
    resetForm()
    await refresh()
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
        <h1 class="text-xl font-semibold">任务</h1>
        <p class="text-sm text-muted">需要人来完成的事情,完成或失败都会再次唤醒智能体。</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="outline" @click="refresh()">刷新</UButton>
        <UButton @click="createOpen = true">新增任务</UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <ActionStatusFilter v-model="group" :options="groupOptions" />
      <USelect
        v-model="assigneeFilter"
        :items="assigneeOptions"
        size="xs"
        class="w-36"
        placeholder="全部负责人"
      />
    </div>

    <div v-if="pending && !items.length" class="flex flex-col gap-3">
      <USkeleton v-for="n in 4" :key="n" class="h-24 rounded-lg" />
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
            <UBadge :color="priorityColor(action.priority)" variant="soft">
              {{ priorityLabel(action.priority) }}
            </UBadge>
            <UBadge :color="statusColor(action.status)" variant="soft">
              {{ statusLabel(action.status) }}
            </UBadge>
          </div>
        </div>

        <p v-if="action.description" class="mt-1 line-clamp-2 break-words text-sm text-muted">
          {{ action.description }}
        </p>

        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <USelect
            v-if="['pending', 'running'].includes(action.status)"
            :model-value="action.assignee_id ?? ''"
            :items="userOptions"
            size="xs"
            placeholder="未指派"
            class="w-32"
            :loading="pendingId === action.id"
            :disabled="pendingId !== null"
            @update:model-value="(value: string) => assign(action.id, value)"
          />
          <span v-else>负责人:{{ assigneeName(action.assignee_id) }}</span>

          <span v-if="action.due_at" :class="isOverdue(action) ? 'text-error' : ''">
            截止 {{ formatDateTime(action.due_at) }}
          </span>
          <UBadge v-if="isOverdue(action)" color="error" variant="soft">逾期</UBadge>
          <span v-if="action.status === 'completed' && action.completed_at">
            完成于 {{ formatDateTime(action.completed_at) }}
          </span>
        </div>

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
        <div v-else-if="['pending', 'running'].includes(action.status)" class="mt-2">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :to="actionDetailPath(projectId, action)"
          >
            处理
          </UButton>
        </div>
      </UCard>
    </div>

    <p v-if="!pending && !filtered.length" class="mt-3 text-sm text-muted">这个范围内没有任务。</p>

    <UModal v-model:open="createOpen" title="新增任务">
      <template #body>
        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
        <div class="flex flex-col gap-4">
          <UFormField label="标题" required>
            <UInput v-model="createForm.title" class="w-full" placeholder="要做什么" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="优先级">
              <USelect v-model="createForm.priority" :items="priorityOptions" class="w-full" />
            </UFormField>
            <UFormField label="负责人">
              <USelect
                v-model="createForm.assignee_id"
                :items="userOptions"
                placeholder="未指派"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="截止时间">
            <UInput v-model="createForm.due_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="描述">
            <UTextarea v-model="createForm.description" :rows="3" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="createOpen = false">取消</UButton>
        <UButton :loading="createBusy" @click="create">创建</UButton>
      </template>
    </UModal>
  </UContainer>
</template>
