<script setup lang="ts">
interface NotificationItem {
  id: string
  type: string
  severity: string
  title: string
  content: string
  project_name: string
  status: string
  created_at: string
}

const api = useApi()

const { data, refresh } = await useAsyncData('notifications', () =>
  api.get<{ items: NotificationItem[]; unread_count: number }>('/notifications'),
)

const busy = ref(false)

async function readOne(id: string) {
  busy.value = true
  try {
    await api.post(`/notifications/${id}/read`, {})
    await refresh()
  } finally {
    busy.value = false
  }
}

async function readAll() {
  busy.value = true
  try {
    await api.post('/notifications/read-all', {})
    await refresh()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">通知</h1>
        <p class="text-muted">智能体认为现在值得你知道的事。</p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="busy || !(data?.unread_count ?? 0)"
        @click="readAll"
      >
        全部已读
      </UButton>
    </div>

    <div v-if="data?.items.length" class="flex flex-col gap-3">
      <UCard
        v-for="item in data.items"
        :key="item.id"
        :variant="item.status === 'unread' ? 'soft' : 'outline'"
        :ui="{ body: 'sm:p-4' }"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <UBadge :color="severityColor(item.severity)" variant="soft">
                {{ item.severity }}
              </UBadge>
              <span class="font-medium">{{ item.title }}</span>
              <span class="text-xs text-muted">{{ item.project_name }}</span>
            </div>
            <p class="text-sm">{{ item.content }}</p>
            <p class="mt-1 text-xs text-muted">{{ formatDateTime(item.created_at) }}</p>
          </div>
          <UButton
            v-if="item.status === 'unread'"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="readOne(item.id)"
          >
            已读
          </UButton>
        </div>
      </UCard>
    </div>

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      title="没有通知"
      description="智能体有新建议或发现风险时会在这里提醒你。"
    />
  </UContainer>
</template>
