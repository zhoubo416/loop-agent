<script setup lang="ts">
interface ProjectDetail {
  id: string
  name: string
  objective: string
  description: string | null
  success_criteria: string[]
  status: string
}

interface MemberItem {
  user_id: string
  name: string
  email: string | null
  role: string
}

interface UserItem {
  id: string
  name: string
  email: string | null
}

interface ScheduleItem {
  id: string
  type: string
  expression: string | null
  status: string
  next_run_at: string | null
  last_run_at: string | null
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)

// 四个请求并行发出,避免串行等待拉长加载时间
const [
  { data: project, refresh: refreshProject, pending },
  { data: members, refresh: refreshMembers },
  { data: schedules, refresh: refreshSchedules },
  { data: users },
] = await Promise.all([
  useAsyncData(
    () => `project-${projectId.value}`,
    () => api.get<ProjectDetail>(`/projects/${projectId.value}`),
  ),
  useAsyncData(
    () => `members-${projectId.value}`,
    () => api.get<{ items: MemberItem[] }>(`/projects/${projectId.value}/members`),
  ),
  useAsyncData(
    () => `schedules-${projectId.value}`,
    () => api.get<{ items: ScheduleItem[] }>(`/projects/${projectId.value}/schedules`),
  ),
  useAsyncData('settings-users', () => api.get<{ items: UserItem[] }>('/users')),
])

const form = reactive({ name: '', objective: '', description: '', successCriteria: '' })
const newMemberId = ref('')
const newSchedule = reactive({ type: 'cron', expression: '0 9 * * *', instruction: '' })
const error = ref('')
const notice = ref('')
const busy = ref(false)

watchEffect(() => {
  if (!project.value) return
  form.name = project.value.name
  form.objective = project.value.objective
  form.description = project.value.description ?? ''
  form.successCriteria = (project.value.success_criteria ?? []).join('\n')
})

const scheduleTypeOptions = [
  { label: 'cron(固定时间)', value: 'cron' },
  { label: '间隔(每 N 分钟/小时)', value: 'interval' },
  { label: '一次性(只执行一次)', value: 'once' },
]

const memberOptions = computed(() => [
  ...(users.value?.items ?? [])
    .filter((user) => !(members.value?.items ?? []).some((member) => member.user_id === user.id))
    .map((user) => ({ label: `${user.name}(${user.email ?? '无邮箱'})`, value: user.id })),
])

async function withBusy(fn: () => Promise<void>, successMessage?: string) {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await fn()
    if (successMessage) notice.value = successMessage
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

function save() {
  void withBusy(async () => {
    await api.patch(`/projects/${projectId.value}`, {
      name: form.name,
      objective: form.objective,
      description: form.description || null,
      success_criteria: form.successCriteria
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    })
    await refreshProject()
  }, '项目已更新。')
}

function addMember() {
  if (!newMemberId.value) return
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/members`, {
      user_id: newMemberId.value,
      role: 'member',
    })
    newMemberId.value = ''
    await refreshMembers()
  }, '成员已加入。')
}

function removeMember(userId: string) {
  void withBusy(async () => {
    await api.del(`/projects/${projectId.value}/members/${userId}`)
    await refreshMembers()
  })
}

function createSchedule() {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/schedules`, {
      type: newSchedule.type,
      expression: newSchedule.expression || null,
      payload: newSchedule.instruction ? { instruction: newSchedule.instruction } : {},
    })
    newSchedule.instruction = ''
    await refreshSchedules()
  }, '定时任务已创建。')
}

function toggleSchedule(schedule: ScheduleItem) {
  void withBusy(async () => {
    const action = schedule.status === 'active' ? 'pause' : 'resume'
    await api.post(`/projects/${projectId.value}/schedules/${schedule.id}/${action}`, {})
    await refreshSchedules()
  })
}

function pause() {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/pause`, {})
    await refreshProject()
  }, '项目已暂停。')
}

function resume() {
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/resume`, {})
    await refreshProject()
  }, '项目已恢复。')
}

function archive() {
  if (!window.confirm('归档后项目不再接受新的触发,历史数据保留。确认归档?')) return
  void withBusy(async () => {
    await api.post(`/projects/${projectId.value}/archive`, {})
    await refreshProject()
  }, '项目已归档。')
}

</script>

<template>
  <UContainer>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">设置</h1>
        <p class="text-muted">项目身份、成员、定时任务与生命周期。</p>
      </div>
      <UBadge v-if="project" :color="statusColor(project.status)" variant="soft">
        {{ statusLabel(project.status) }}
      </UBadge>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
    <UAlert v-if="notice" color="success" variant="soft" :title="notice" class="mb-4" />

    <div v-if="pending && !project" class="flex flex-col gap-4">
      <USkeleton class="h-72 rounded-xl" />
      <USkeleton class="h-48 rounded-xl" />
      <USkeleton class="h-48 rounded-xl" />
      <USkeleton class="h-28 rounded-xl" />
    </div>

    <template v-else>
    <UCard class="mb-4">
      <template #header>
        <span class="font-medium">基本信息</span>
      </template>
      <div class="flex flex-col gap-4">
        <UFormField label="名称">
          <UInput v-model="form.name" class="w-full" />
        </UFormField>
        <UFormField label="Objective">
          <UTextarea v-model="form.objective" :rows="2" class="w-full" />
        </UFormField>
        <UFormField label="描述">
          <UTextarea v-model="form.description" :rows="3" class="w-full" />
        </UFormField>
        <UFormField label="成功标准" help="每行一条,完成条件">
          <UTextarea v-model="form.successCriteria" :rows="3" class="w-full" />
        </UFormField>
        <div>
          <UButton :loading="busy" @click="save">保存</UButton>
        </div>
      </div>
    </UCard>

    <UCard class="mb-4">
      <template #header>
        <span class="font-medium">成员</span>
      </template>
      <div class="flex flex-col gap-3">
        <div
          v-for="member in members?.items ?? []"
          :key="member.user_id"
          class="flex items-center justify-between gap-3 border-b border-default pb-3 last:border-0 last:pb-0"
        >
          <div>
            <div class="font-medium">{{ member.name }}</div>
            <div class="text-xs text-muted">{{ member.email }}</div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge color="neutral" variant="soft">{{ member.role }}</UBadge>
            <UButton
              v-if="member.role !== 'owner'"
              size="xs"
              color="error"
              variant="ghost"
              :disabled="busy"
              @click="removeMember(member.user_id)"
            >
              移除
            </UButton>
          </div>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <USelect
          v-model="newMemberId"
          :items="memberOptions"
          placeholder="选择要加入的成员"
          class="w-64"
          :disabled="busy"
        />
        <UButton :disabled="busy || !newMemberId" @click="addMember">加入项目</UButton>
      </div>
    </UCard>

    <UCard class="mb-4">
      <template #header>
        <span class="font-medium">定时任务</span>
      </template>
      <div v-if="schedules?.items.length" class="flex flex-col gap-3">
        <div
          v-for="schedule in schedules.items"
          :key="schedule.id"
          class="flex flex-wrap items-center justify-between gap-3 border-b border-default pb-3 last:border-0 last:pb-0"
        >
          <div>
            <div class="font-medium">{{ schedule.type }} · {{ schedule.expression || '—' }}</div>
            <div class="text-xs text-muted">
              下次触发 {{ formatDateTime(schedule.next_run_at) }} · 上次触发
              {{ formatDateTime(schedule.last_run_at) }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge :color="statusColor(schedule.status)" variant="soft">
              {{ statusLabel(schedule.status) }}
            </UBadge>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :disabled="busy"
              @click="toggleSchedule(schedule)"
            >
              {{ schedule.status === 'active' ? '暂停' : '恢复' }}
            </UButton>
          </div>
        </div>
      </div>
      <p v-else-if="schedules" class="text-sm text-muted">
        还没有定时任务,智能体目前只在你提供新信息时被唤醒。
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <USelect v-model="newSchedule.type" :items="scheduleTypeOptions" class="w-44" />
        <UInput
          v-model="newSchedule.expression"
          class="w-52"
          :placeholder="newSchedule.type === 'interval' ? '30m / 6h / 1d' : '0 9 * * *'"
        />
        <UInput
          v-model="newSchedule.instruction"
          class="w-72"
          placeholder="触发时给智能体的指令(可选)"
        />
        <UButton :disabled="busy" @click="createSchedule">新增</UButton>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <span class="font-medium">项目状态</span>
      </template>
      <p class="mb-3 text-sm text-muted">
        项目完成需要满足成功标准与开放问题的条件,由智能体提议、用户确认。
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="project?.status !== 'paused'" color="warning" variant="outline" :disabled="busy" @click="pause">
          暂停
        </UButton>
        <UButton v-if="project?.status === 'paused'" :disabled="busy" @click="resume">恢复</UButton>
        <span class="text-sm text-muted">
          完成需要智能体在概览提出完成建议,由你在那里确认。
        </span>
        <UButton
          v-if="project?.status !== 'archived'"
          color="error"
          variant="outline"
          :disabled="busy"
          @click="archive"
        >
          归档项目
        </UButton>
      </div>
    </UCard>
    </template>
  </UContainer>
</template>
