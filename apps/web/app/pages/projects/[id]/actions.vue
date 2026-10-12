<script setup lang="ts">
interface ActionItem {
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
}

interface UserItem {
  id: string
  name: string
  email: string | null
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)

// 两个请求并行发出,避免串行等待拉长加载时间
const [{ data, refresh }, { data: users }] = await Promise.all([
  useAsyncData(
    () => `actions-${projectId.value}`,
    () => api.get<{ items: ActionItem[] }>(`/projects/${projectId.value}/actions`),
  ),
  useAsyncData('users', () => api.get<{ items: UserItem[] }>('/users')),
])

const filterOptions = [
  { label: '进行中', value: 'open' },
  { label: '待确认', value: 'proposed' },
  { label: '待处理', value: 'pending' },
  { label: '执行中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '全部', value: 'all' },
]
const statusFilter = ref('open')

const filtered = computed(() => {
  const items = data.value?.items ?? []
  if (statusFilter.value === 'all') return items
  if (statusFilter.value === 'open') {
    return items.filter((item) => ['pending', 'running'].includes(item.status))
  }
  return items.filter((item) => item.status === statusFilter.value)
})

const error = ref('')
const busy = ref(false)

const userOptions = computed(() =>
  (users.value?.items ?? []).map((user) => ({ label: user.name, value: user.id })),
)

const kindOptions = [
  { label: '任务', value: 'task' },
  { label: '会议', value: 'meeting' },
  { label: '资料', value: 'document' },
]

const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '严重', value: 'critical' },
]

const createOpen = ref(false)
const createForm = reactive({
  title: '',
  kind: 'task',
  priority: 'medium',
  description: '',
  assignee_id: '',
})

async function withBusy(fn: () => Promise<void>) {
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

function assign(action: ActionItem, userId: string) {
  void withBusy(async () => {
    await api.patch(`/projects/${projectId.value}/actions/${action.id}`, {
      assignee_id: userId || null,
    })
    await refresh()
  })
}

function confirm(action: ActionItem) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/actions/${action.id}/confirm`, {})
    await refresh()
  })
}

function decline(action: ActionItem) {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/actions/${action.id}/decline`, {})
    await refresh()
  })
}

async function create() {
  if (busy.value) return
  if (!createForm.title.trim()) {
    error.value = '标题不能为空'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await api.post(`/projects/${projectId.value}/actions`, {
      title: createForm.title,
      kind: createForm.kind,
      priority: createForm.priority,
      description: createForm.description || null,
      assignee_id: createForm.assignee_id || null,
    })
    createOpen.value = false
    createForm.title = ''
    createForm.kind = 'task'
    createForm.priority = 'medium'
    createForm.description = ''
    createForm.assignee_id = ''
    await refresh()
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer>
    <div class="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">行动</h1>
        <p class="text-sm text-muted">行动是智能体的执行出口,完成或失败都会再次唤醒它。</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton color="neutral" variant="outline" @click="refresh()">刷新</UButton>
        <UButton @click="createOpen = true">新增行动</UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

    <div class="mb-3 flex flex-wrap gap-2">
      <UButton
        v-for="option in filterOptions"
        :key="option.value"
        size="xs"
        :variant="statusFilter === option.value ? 'solid' : 'outline'"
        :color="statusFilter === option.value ? 'primary' : 'neutral'"
        @click="statusFilter = option.value"
      >
        {{ option.label }}
      </UButton>
    </div>

    <div v-if="pending && !data" class="flex flex-col gap-3">
      <USkeleton v-for="n in 4" :key="n" class="h-20 rounded-lg" />
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
            <UBadge :color="kindColor(action.kind)" variant="soft">{{ kindLabel(action.kind) }}</UBadge>
            <UBadge :color="priorityColor(action.priority)" variant="soft">{{ priorityLabel(action.priority) }}</UBadge>
            <UBadge :color="statusColor(action.status)" variant="soft">{{ statusLabel(action.status) }}</UBadge>
          </div>
        </div>

        <p v-if="action.description" class="mt-1 break-words whitespace-pre-wrap text-sm text-muted">
          {{ action.description }}
        </p>

        <div
          v-if="action.status === 'proposed'"
          class="mt-2 flex flex-wrap items-center gap-2"
        >
          <UButton size="xs" :disabled="busy" @click="confirm(action)">确认</UButton>
          <UButton size="xs" color="error" variant="ghost" :disabled="busy" @click="decline(action)">
            拒绝
          </UButton>
        </div>

        <div
          v-if="['pending', 'running'].includes(action.status)"
          class="mt-2 flex flex-wrap items-center gap-2"
        >
          <USelect
            :model-value="action.assignee_id ?? ''"
            :items="userOptions"
            size="xs"
            placeholder="未指派"
            class="w-32"
            :disabled="busy"
            @update:model-value="(value: string) => assign(action, value)"
          />
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

    <p v-if="!pending && !filtered.length" class="mt-3 text-sm text-muted">这个范围内没有行动。</p>

    <UModal v-model:open="createOpen" title="新增行动">
      <template #body>
        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
        <div class="flex flex-col gap-4">
          <UFormField label="标题" required>
            <UInput v-model="createForm.title" class="w-full" placeholder="要做什么" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="类型">
              <USelect v-model="createForm.kind" :items="kindOptions" class="w-full" />
            </UFormField>
            <UFormField label="优先级">
              <USelect v-model="createForm.priority" :items="priorityOptions" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="负责人">
            <USelect
              v-model="createForm.assignee_id"
              :items="userOptions"
              placeholder="未指派"
              class="w-full"
            />
          </UFormField>
          <UFormField label="描述">
            <UTextarea v-model="createForm.description" :rows="3" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="createOpen = false">取消</UButton>
        <UButton :loading="busy" @click="create">创建</UButton>
      </template>
    </UModal>
  </UContainer>
</template>
