<script setup lang="ts">
import type { ActionExecution } from '~/utils/action'

const props = defineProps<{
  status: string
  kind: string
  executions: ActionExecution[]
  /** 结论上方的小标签,任务详情用来标成「完成情况」 */
  summaryLabel?: string | null
}>()

/** 取最近一次有产出的执行作为行动结果,执行记录按时间倒序 */
const result = computed(() => latestCompletedOutput(props.executions))

const completedExecution = computed(() =>
  props.executions.find((item) => item.status === 'completed'),
)

const failureMessage = computed(() => {
  const error = props.executions[0]?.error as { message?: string } | null | undefined
  return error?.message ?? '这次行动没有成功完成'
})

const cancelMessage = computed(() => {
  const message = (props.executions[0]?.error as { message?: string } | null)?.message
  return message && message !== '用户取消' ? message : null
})

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asLines(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
}

const summary = computed(() => asText(result.value?.summary))
const notes = computed(() => asText(result.value?.notes))
const content = computed(() => asText(result.value?.content))
const participants = computed(() => participantsFromOutput(result.value))

/** 按行动类型决定要展示哪些结构化字段 */
const sections = computed(() => {
  const output = result.value
  if (!output) return []
  if (props.kind === 'meeting') {
    return [
      { label: '纪要', text: notes.value, lines: [] as string[] },
      { label: '决定', text: '', lines: asLines(output.decisions) },
      { label: '后续行动', text: '', lines: asLines(output.action_items ?? output.actionItems) },
    ]
  }
  if (props.kind === 'document') {
    return [
      { label: '要点', text: '', lines: asLines(output.key_points ?? output.keyPoints) },
      { label: '内容', text: content.value, lines: [] as string[] },
    ]
  }
  return [
    { label: '结果', text: '', lines: asLines(output.results) },
    { label: '阻塞', text: '', lines: asLines(output.blockers) },
    { label: '说明', text: notes.value, lines: [] as string[] },
  ]
})

const visibleSections = computed(() =>
  sections.value.filter((section) => section.text || section.lines.length),
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <UAlert
      v-if="status === 'failed'"
      color="error"
      variant="soft"
      icon="i-lucide-circle-x"
      title="这次行动没有成功"
      :description="failureMessage"
    />
    <UAlert
      v-else-if="status === 'cancelled'"
      color="neutral"
      variant="soft"
      icon="i-lucide-ban"
      title="这次行动已取消"
      :description="cancelMessage ?? undefined"
    />
    <UAlert
      v-else-if="status === 'proposed'"
      color="warning"
      variant="soft"
      icon="i-lucide-clock"
      title="这个行动还在等待确认"
      description="确认后才会进入执行，可以在上方直接确认或拒绝。"
    />

    <template v-else-if="status === 'completed'">
      <div
        v-if="summary"
        class="flex gap-3 rounded-xl bg-success/5 px-4 py-3 ring-1 ring-success/15"
      >
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
        >
          <UIcon name="i-lucide-check" class="size-4" />
        </div>
        <div class="min-w-0">
          <p v-if="summaryLabel" class="text-xs font-medium text-muted">{{ summaryLabel }}</p>
          <p class="mt-0.5 break-words whitespace-pre-wrap text-[15px] leading-7 text-default">
            {{ summary }}
          </p>
        </div>
      </div>

      <div v-if="participants.length" class="flex flex-col gap-2">
        <span class="text-xs font-medium text-muted">参与人</span>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="participant in participants"
            :key="participant"
            class="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 text-xs text-default"
          >
            <UAvatar :text="participant.slice(0, 1)" :alt="participant" size="3xs" />
            {{ participant }}
          </span>
        </div>
      </div>

      <div v-for="section in visibleSections" :key="section.label" class="flex flex-col gap-2">
        <span class="text-xs font-medium text-muted">{{ section.label }}</span>
        <p v-if="section.text" class="break-words whitespace-pre-wrap text-sm leading-7">
          {{ section.text }}
        </p>
        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="(line, index) in section.lines"
            :key="index"
            class="flex gap-2 text-sm leading-7"
          >
            <span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span class="min-w-0 break-words">{{ line }}</span>
          </li>
        </ul>
      </div>

      <div
        v-if="completedExecution"
        class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-default pt-3 text-xs text-muted"
      >
        <UIcon name="i-lucide-check-check" class="size-3.5" />
        <span>{{ executorLabel(completedExecution.executor_type) }}完成</span>
        <span v-if="completedExecution.completed_at">
          · {{ formatDateTime(completedExecution.completed_at) }}
        </span>
      </div>

      <UEmpty
        v-if="!summary && !visibleSections.length && !participants.length"
        variant="naked"
        size="sm"
        icon="i-lucide-clipboard-x"
        title="这次执行没有留下结构化结果"
        description="完成时没有提交结果内容。"
      />
    </template>

    <UEmpty
      v-else
      variant="naked"
      size="sm"
      icon="i-lucide-hourglass"
      title="还没有结果"
      description="行动完成后会在这里展示结果。"
    />
  </div>
</template>
