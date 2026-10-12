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

defineProps<{ executions: ExecutionItem[] }>()

function summaryOf(execution: ExecutionItem): string {
  const summary = execution.output?.summary
  return typeof summary === 'string' ? summary : ''
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

const fieldLabels: Array<[string, string]> = [
  ['participants', '参与人'],
  ['decisions', '决定'],
  ['action_items', '后续行动'],
  ['key_points', '要点'],
  ['results', '结果'],
  ['blockers', '阻塞'],
]

function fieldsOf(execution: ExecutionItem): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = []
  for (const [key, label] of fieldLabels) {
    const list = asList(execution.output?.[key])
    if (list.length) result.push({ label, value: list.join('、') })
  }
  const notes = execution.output?.notes
  if (typeof notes === 'string' && notes.trim()) {
    result.push({ label: '说明', value: notes.trim() })
  }
  const content = execution.output?.content
  if (typeof content === 'string' && content.trim()) {
    result.push({ label: '内容', value: content.trim() })
  }
  return result
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-medium">执行历史</span>
    </template>
    <div v-if="executions.length" class="flex flex-col gap-3">
      <div
        v-for="execution in executions"
        :key="execution.id"
        class="border-b border-default pb-3 last:border-0 last:pb-0"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted">{{ formatDateTime(execution.started_at) }}</span>
          <UBadge :color="statusColor(execution.status)" variant="soft">
            {{ statusLabel(execution.status) }}
          </UBadge>
        </div>
        <p v-if="summaryOf(execution)" class="mt-1 text-sm">{{ summaryOf(execution) }}</p>
        <dl v-if="fieldsOf(execution).length" class="mt-1 flex flex-col gap-0.5">
          <div v-for="field in fieldsOf(execution)" :key="field.label" class="text-sm">
            <span class="text-muted">{{ field.label }}:</span>
            {{ field.value }}
          </div>
        </dl>
        <p v-if="execution.error" class="mt-1 text-sm text-error">
          {{ (execution.error as { message?: string }).message }}
        </p>
      </div>
    </div>
    <p v-else class="text-sm text-muted">还没有执行记录。</p>
  </UCard>
</template>
