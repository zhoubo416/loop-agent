<script setup lang="ts">
interface TimelineItem {
  id: string
  type: string
  title: string
  content: string
  status?: string
  created_at: string
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)

const { data, refresh, pending } = await useAsyncData(
  () => `timeline-${projectId.value}`,
  () => api.get<{ items: TimelineItem[] }>(`/projects/${projectId.value}/timeline`),
)

const filters = [
  { label: '全部', value: 'all' },
  { label: '观察', value: 'observation' },
  { label: '事件', value: 'event' },
  { label: '建议', value: 'recommendation' },
  { label: '行动', value: 'action' },
  { label: '执行', value: 'execution' },
]
const filter = ref('all')

const filtered = computed(() =>
  (data.value?.items ?? []).filter((item) => filter.value === 'all' || item.type === filter.value),
)
</script>

<template>
  <UContainer>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">时间线</h1>
        <p class="text-muted">观察、事件、行动、执行与建议按时间排列。</p>
      </div>
      <UButton color="neutral" variant="outline" @click="refresh()">刷新</UButton>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <UButton
        v-for="option in filters"
        :key="option.value"
        size="xs"
        :variant="filter === option.value ? 'solid' : 'outline'"
        :color="filter === option.value ? 'primary' : 'neutral'"
        @click="filter = option.value"
      >
        {{ option.label }}
      </UButton>
    </div>

    <UCard>
      <div v-if="pending && !data" class="flex flex-col gap-3">
        <USkeleton v-for="n in 6" :key="n" class="h-16" />
      </div>
      <div v-else-if="filtered.length" class="flex flex-col gap-3">
        <div
          v-for="item in filtered"
          :key="`${item.type}-${item.id}`"
          class="lo-timeline-row border-b border-default pb-3 last:border-0 last:pb-0"
        >
          <span class="text-xs text-muted">{{ formatDateTime(item.created_at) }}</span>
          <span class="text-xs text-muted">{{ timelineTypeLabels[item.type] ?? item.type }}</span>
          <div class="flex flex-col gap-1">
            <!-- eslint-disable-next-line vue/no-v-html -- 标题与正文带 Markdown 格式,markdown-it 已转义原始 HTML -->
            <div class="lo-md" v-html="renderMarkdown(item.title)"></div>
            <!-- eslint-disable-next-line vue/no-v-html -- 同上 -->
            <div
              v-if="item.content && item.content !== item.title"
              class="lo-md text-sm text-muted"
              v-html="renderMarkdown(item.content)"
            ></div>
            <UBadge v-if="item.status" :color="statusColor(item.status)" variant="soft" class="w-fit">
              {{ statusLabel(item.status) }}
            </UBadge>
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-muted">这个范围内还没有记录。</p>
    </UCard>
  </UContainer>
</template>
