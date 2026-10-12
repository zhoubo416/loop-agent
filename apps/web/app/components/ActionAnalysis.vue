<script setup lang="ts">
interface AnalysisItem {
  id: string
  status: string
  created_at: string
  judgment: string | null
  recommendations: Array<{ id: string; type: string; content: string; priority: string; status: string }>
  events: Array<{ id: string; type: string; title: string }>
}

defineProps<{ analysis: AnalysisItem[] }>()
</script>

<template>
  <UCard v-if="analysis.length" class="lg:col-span-3">
    <template #header>
      <span class="font-medium">智能体分析</span>
    </template>
    <div class="flex flex-col gap-4">
      <div
        v-for="item in analysis"
        :key="item.id"
        class="border-b border-default pb-4 last:border-0 last:pb-0"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-muted">{{ formatDateTime(item.created_at) }}</span>
          <UBadge :color="statusColor(item.status)" variant="soft">
            {{ statusLabel(item.status) }}
          </UBadge>
        </div>

        <p v-if="item.judgment" class="mt-1 whitespace-pre-wrap text-sm">{{ item.judgment }}</p>

        <div v-if="item.events.length" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="event in item.events"
            :key="event.id"
            class="rounded bg-elevated px-2 py-0.5 text-xs text-muted"
          >
            {{ event.title }}
          </span>
        </div>

        <div v-if="item.recommendations.length" class="mt-2 flex flex-col gap-2">
          <div
            v-for="recommendation in item.recommendations"
            :key="recommendation.id"
            class="rounded-lg border border-default p-2"
          >
            <div class="flex items-center gap-1.5">
              <UBadge :color="priorityColor(recommendation.priority)" variant="soft">
                {{ priorityLabel(recommendation.priority) }}
              </UBadge>
              <UBadge :color="statusColor(recommendation.status)" variant="soft">
                {{ statusLabel(recommendation.status) }}
              </UBadge>
            </div>
            <p class="mt-1 text-sm">{{ recommendation.content }}</p>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
