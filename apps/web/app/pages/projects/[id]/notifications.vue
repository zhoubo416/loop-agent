<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => route.params.id as string)

// 这一页只列当前项目的通知,和侧边栏会话列表里的那条「通知」共用同一份数据
const { items, unreadCount, pending, busy, read, readAll } = useNotifications(projectId)
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
        :disabled="busy || !unreadCount"
        @click="readAll"
      >
        全部已读
      </UButton>
    </div>

    <div v-if="pending && !items.length" class="flex flex-col gap-3">
      <USkeleton v-for="n in 4" :key="n" class="h-20 rounded-lg" />
    </div>
    <div v-else-if="items.length" class="flex flex-col gap-3">
      <UCard
        v-for="item in items"
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
            @click="read(item.id)"
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
