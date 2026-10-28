<script setup lang="ts">
import type { UserItem } from '~/composables/useActionList'
import type { ActionDetailBase } from '~/utils/action'

type TaskDetail = ActionDetailBase

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)
const actionId = computed(() => route.params.actionId as string)

const [{ data: action, refresh, pending, error: loadError }, { data: users }] = await Promise.all([
  useAsyncData(
    () => `task-${actionId.value}`,
    () => api.get<TaskDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
  ),
  useAsyncData('users', () => api.get<{ items: UserItem[] }>('/users')),
])

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
  assign,
  confirm,
  decline,
} = useActionOps(projectId, refresh)

const pageError = computed(
  () => loadError.value?.message || lifecycleError.value || opsError.value,
)

const summary = ref('')
const results = ref('')
const blockers = ref('')
const formError = ref('')
const failOpen = ref(false)
const cancelOpen = ref(false)

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))
const proposed = computed(() => action.value?.status === 'proposed')

// 标题经常就是描述,重复的不再展示
const description = computed(() => {
  const value = action.value?.description
  return value && !isSameText(value, action.value?.title) ? value : null
})

const longDescription = computed(() => {
  const value = description.value
  return Boolean(value && (value.length > 80 || value.includes('\n')))
})

const userOptions = computed(() =>
  (users.value?.items ?? []).map((user) => ({ label: user.name, value: user.id })),
)

const assigneeName = computed(() => {
  if (!action.value?.assignee_id) return '未指派'
  return (
    userOptions.value.find((option) => option.value === action.value?.assignee_id)?.label ?? '未指派'
  )
})

const overdue = computed(() => {
  if (!action.value?.due_at) return false
  if (!['pending', 'running'].includes(action.value.status)) return false
  return new Date(action.value.due_at).getTime() < Date.now()
})

const dueHint = computed(() => {
  const dueAt = action.value?.due_at
  if (!dueAt || !['pending', 'running'].includes(action.value?.status ?? '')) return ''
  const diff = new Date(dueAt).getTime() - Date.now()
  if (Number.isNaN(diff)) return ''
  if (diff < 0) {
    const days = Math.max(1, Math.ceil(Math.abs(diff) / 86400000))
    return `逾期 ${days} 天`
  }
  if (diff < 86400000) return '今天截止'
  const days = Math.ceil(diff / 86400000)
  if (days <= 7) return `还剩 ${days} 天`
  return ''
})

const moreActions = computed(() => [
  {
    label: '标记失败',
    icon: 'i-lucide-circle-x',
    onSelect: () => {
      failOpen.value = true
    },
  },
  {
    label: '取消任务',
    icon: 'i-lucide-ban',
    color: 'error' as const,
    onSelect: () => {
      cancelOpen.value = true
    },
  },
])

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

watch(summary, () => {
  if (formError.value) formError.value = ''
})

function submit() {
  const conclusion = summary.value.trim()
  if (!conclusion) {
    formError.value = '请先写一句完成情况，智能体要据此决定下一步'
    return
  }
  formError.value = ''
  void complete(
    { results: lines(results.value), blockers: lines(blockers.value) },
    conclusion,
  )
}
</script>

<template>
  <div>
    <ActionDetailLayout
      kind="task"
      :loading="pending && !action"
      :title="action?.title"
      :description="description"
      :status="action?.status"
      :priority="action?.priority"
      :back-to="`/projects/${projectId}/tasks`"
      :created-at="action?.created_at"
      :completed-at="action?.completed_at"
      :error="pageError"
      :notice="notice"
    >
      <template #meta>
        <template v-if="action">
          <span class="inline-flex items-center gap-1.5">
            <UAvatar
              v-if="action.assignee_id"
              :text="assigneeName.slice(0, 1)"
              :alt="assigneeName"
              size="3xs"
            />
            <UIcon v-else name="i-lucide-user-x" class="size-3.5" />
            负责人 {{ assigneeName }}
          </span>
          <span
            v-if="action.due_at"
            class="inline-flex items-center gap-1.5"
            :class="overdue ? 'text-error' : ''"
          >
            <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
            截止 {{ formatDateTime(action.due_at) }}
            <template v-if="dueHint">· {{ dueHint }}</template>
          </span>
          <UBadge v-if="overdue" color="error" variant="soft">逾期</UBadge>
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
            确认任务
          </UButton>
        </template>
      </template>

      <template #main>
        <template v-if="action">
          <ActionDetails title="任务信息">
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
            <ActionProperty label="负责人">
              <div v-if="editable" class="flex justify-end">
                <USelect
                  :model-value="action.assignee_id ?? ''"
                  :items="userOptions"
                  size="xs"
                  placeholder="未指派"
                  class="w-36"
                  :loading="pendingId === actionId"
                  :disabled="pendingId !== null"
                  @update:model-value="(value: string) => assign(actionId, value)"
                />
              </div>
              <span v-else>{{ assigneeName }}</span>
            </ActionProperty>
            <ActionProperty v-if="action.due_at" label="截止时间">
              <span :class="overdue ? 'text-error' : ''">{{ formatDateTime(action.due_at) }}</span>
              <span v-if="dueHint" class="ml-1 text-xs text-muted">· {{ dueHint }}</span>
            </ActionProperty>
            <ActionProperty label="执行者">{{ executorLabel(action.executor_type) }}</ActionProperty>
            <ActionProperty label="创建时间">{{ formatDateTime(action.created_at) }}</ActionProperty>
            <ActionProperty v-if="action.completed_at" label="完成时间">
              {{ formatDateTime(action.completed_at) }}
            </ActionProperty>
          </ActionDetails>

          <ActionPanel
            v-if="description && longDescription"
            title="任务说明"
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
            description="这是智能体提议的任务，确认后才进入待处理。"
          >
            <p class="text-sm leading-relaxed text-muted">
              确认后可以指派负责人并开始执行；拒绝后这个任务不会再出现在进行中的列表里。
            </p>
          </ActionPanel>

          <ActionPanel
            v-else-if="editable"
            title="完成任务"
            icon="i-lucide-circle-check-big"
            description="完成后，结果会交给智能体，它会更新项目状态并决定下一步。"
          >
            <div class="flex flex-col gap-5">
              <UFormField label="完成情况" required help="一句话说明做成了什么">
                <UTextarea
                  v-model="summary"
                  :rows="3"
                  :maxrows="6"
                  autoresize
                  class="w-full"
                  placeholder="比如:已补齐五组实验数据，并存到共享盘"
                />
              </UFormField>
              <p v-if="formError" class="text-sm text-error">{{ formError }}</p>
              <div class="grid gap-5 md:grid-cols-2">
                <UFormField label="具体结果" help="每行一条">
                  <UTextarea
                    v-model="results"
                    :rows="4"
                    :maxrows="8"
                    autoresize
                    class="w-full"
                    placeholder="数据、文件位置、统计结论等"
                  />
                </UFormField>
                <UFormField label="遇到的问题" help="没有就留空">
                  <UTextarea
                    v-model="blockers"
                    :rows="4"
                    :maxrows="8"
                    autoresize
                    class="w-full"
                    placeholder="比如:缺少一组对照数据"
                  />
                </UFormField>
              </div>
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
            :title="action.status === 'completed' ? '任务结果' : '任务状态'"
            icon="i-lucide-clipboard-check"
          >
            <ActionResult
              :status="action.status"
              kind="task"
              :executions="action.executions"
              summary-label="完成情况"
            />
          </ActionPanel>
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
          source-heading="为什么有这个任务"
          source-hint="智能体当时看到的内容，以及它决定提出这个任务的原因。"
        />
      </template>
    </ActionDetailLayout>

    <ActionReasonModal
      v-model:open="failOpen"
      title="标记任务失败"
      description="失败原因会交给智能体，它会据此调整下一步。"
      placeholder="比如:缺少原始数据，无法完成统计分析"
      confirm-label="标记失败"
      confirm-color="warning"
      :busy="busy"
      @confirm="(reason) => fail(reason)"
    />

    <ActionReasonModal
      v-model:open="cancelOpen"
      title="取消任务"
      description="取消原因可留空。取消后这个任务不会再出现在进行中的列表里，智能体也会收到通知。"
      placeholder="比如:研究路线调整，这件事不再需要做"
      confirm-label="取消任务"
      confirm-color="error"
      :require-reason="false"
      :busy="busy"
      @confirm="(reason) => cancel(reason || undefined)"
    />
  </div>
</template>
