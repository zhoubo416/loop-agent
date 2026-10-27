<script setup lang="ts">
import type { ActionExecution } from '~/utils/action'

defineProps<{ executions: ActionExecution[] }>()

function summaryOf(execution: ActionExecution): string {
  const summary = execution.output?.summary
  return typeof summary === 'string' ? summary.trim() : ''
}

function errorOf(execution: ActionExecution): string {
  const message = (execution.error as { message?: string } | null)?.message
  return typeof message === 'string' ? message.trim() : ''
}

function dotClass(status: string): string {
  const colors: Record<string, string> = {
    completed: 'bg-success',
    failed: 'bg-error',
    cancelled: 'bg-inverted/20',
    running: 'bg-info',
    pending: 'bg-warning',
  }
  return colors[status] ?? 'bg-elevated'
}
</script>

<template>
  <div v-if="executions.length" class="relative flex flex-col gap-4 border-l border-default pl-4">
    <div v-for="execution in executions" :key="execution.id" class="relative">
      <span
        class="absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-default"
        :class="dotClass(execution.status)"
      ></span>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-[11px] text-muted">{{ formatDateTime(execution.started_at) }}</span>
        <UBadge :color="statusColor(execution.status)" variant="soft">
          {{ statusLabel(execution.status) }}
        </UBadge>
      </div>
      <p class="mt-1 text-xs text-muted">{{ executorLabel(execution.executor_type) }}</p>
      <p v-if="summaryOf(execution)" class="mt-1 text-sm leading-relaxed">
        {{ summaryOf(execution) }}
      </p>
      <p v-if="errorOf(execution)" class="mt-1 text-sm leading-relaxed text-error">
        {{ errorOf(execution) }}
      </p>
    </div>
  </div>
  <p v-else class="text-sm text-muted">还没有执行记录。</p>
</template>
