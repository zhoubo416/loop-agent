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

const props = defineProps<{
  status: string
  kind: string
  executions: ExecutionItem[]
}>()

/** 取最近一次有产出的执行作为行动结果,执行记录按时间倒序 */
const result = computed(() => {
  const completed = props.executions.find((item) => item.status === 'completed')
  return completed?.output ?? null
})

const failureMessage = computed(() => {
  const error = props.executions[0]?.error as { message?: string } | null | undefined
  return error?.message ?? '这次行动没有成功完成'
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

const participants = computed(() => {
  if (props.kind !== 'meeting' || !result.value) return []
  const value = result.value.participants
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
  return []
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      v-if="status === 'failed'"
      color="error"
      variant="soft"
      title="这次行动没有成功"
      :description="failureMessage"
    />
    <UAlert
      v-else-if="status === 'cancelled'"
      color="neutral"
      variant="soft"
      title="这次行动已取消"
    />
    <UAlert
      v-else-if="status === 'proposed'"
      color="warning"
      variant="soft"
      title="这个行动还在等待确认"
      description="确认后才会进入执行,可以在行动列表里确认或拒绝。"
    />

    <template v-else-if="status === 'completed'">
      <p v-if="summary" class="text-base leading-relaxed">{{ summary }}</p>

      <div v-if="participants.length" class="text-sm">
        <span class="text-muted">参与人:</span>{{ participants.join('、') }}
      </div>

      <div v-for="section in visibleSections" :key="section.label" class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted">{{ section.label }}</span>
        <p v-if="section.text" class="text-sm leading-relaxed whitespace-pre-wrap">{{ section.text }}</p>
        <ul v-else class="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed">
          <li v-for="(line, index) in section.lines" :key="index">{{ line }}</li>
        </ul>
      </div>

      <p v-if="!summary && !visibleSections.length && !participants.length" class="text-sm text-muted">
        这次执行没有留下结构化结果。
      </p>
    </template>
  </div>
</template>