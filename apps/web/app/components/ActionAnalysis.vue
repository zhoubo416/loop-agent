<script setup lang="ts">
import type { ActionAnalysisItem } from '~/utils/action'

defineProps<{ analysis: ActionAnalysisItem[] }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="item in analysis"
      :key="item.id"
      class="flex flex-col gap-3 border-b border-default pb-4 last:border-0 last:pb-0"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted">{{ formatDateTime(item.created_at) }}</span>
        <UBadge :color="statusColor(item.status)" variant="soft">
          {{ statusLabel(item.status) }}
        </UBadge>
      </div>

      <div v-if="item.judgment" class="flex gap-2 rounded-lg bg-primary/5 px-3 py-2.5">
        <UIcon name="i-lucide-quote" class="mt-0.5 size-3.5 shrink-0 text-primary" />
        <p class="break-words whitespace-pre-wrap text-sm leading-relaxed text-default">
          {{ item.judgment }}
        </p>
      </div>

      <div v-if="item.events.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="event in item.events"
          :key="event.id"
          class="inline-flex max-w-full items-center gap-1 break-words rounded-full bg-default px-2 py-0.5 text-[11px] text-muted ring-1 ring-default"
        >
          <UIcon name="i-lucide-zap" class="size-3" />
          {{ event.title }}
        </span>
      </div>

      <div v-if="item.recommendations.length" class="flex flex-col gap-2">
        <div
          v-for="recommendation in item.recommendations"
          :key="recommendation.id"
          class="rounded-lg bg-default p-3 ring-1 ring-default"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="priorityColor(recommendation.priority)" variant="soft">
              {{ priorityLabel(recommendation.priority) }}
            </UBadge>
            <UBadge :color="statusColor(recommendation.status)" variant="subtle">
              {{ statusLabel(recommendation.status) }}
            </UBadge>
          </div>
          <p class="mt-1.5 break-words text-sm leading-relaxed">{{ recommendation.content }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
