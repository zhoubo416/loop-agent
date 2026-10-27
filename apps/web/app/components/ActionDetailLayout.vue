<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    kind: 'task' | 'meeting' | 'document'
    loading?: boolean
    title?: string
    description?: string | null
    status?: string
    priority?: string
    backTo: string
    createdAt?: string | null
    completedAt?: string | null
    error?: string
    notice?: string
  }>(),
  {
    loading: false,
    title: '',
    description: null,
    status: 'pending',
    priority: 'medium',
    createdAt: null,
    completedAt: null,
    error: '',
    notice: '',
  },
)

const typeMeta = computed(
  () =>
    ({
      task: {
        navLabel: '任务',
        icon: 'i-lucide-list-checks',
        tile: 'bg-info/10 text-info ring-info/20',
      },
      meeting: {
        navLabel: '会议',
        icon: 'i-lucide-video',
        tile: 'bg-primary/10 text-primary ring-primary/20',
      },
      document: {
        navLabel: '资料库',
        icon: 'i-lucide-folder-open',
        tile: 'bg-success/10 text-success ring-success/20',
      },
    })[props.kind],
)

const errorMessage = computed(() => props.error || '')
const noticeMessage = computed(() => props.notice || '')
</script>

<template>
  <UContainer>
    <div v-if="errorMessage || noticeMessage" class="mb-4 flex flex-col gap-2">
      <UAlert
        v-if="errorMessage"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="errorMessage"
      />
      <UAlert
        v-if="noticeMessage"
        color="info"
        variant="soft"
        icon="i-lucide-info"
        :title="noticeMessage"
      />
    </div>

    <div v-if="loading" class="flex flex-col gap-5" aria-busy="true">
      <div class="flex items-start gap-4 border-b border-default pb-5">
        <USkeleton class="size-11 shrink-0 rounded-xl" />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <USkeleton class="h-3 w-20" />
          <USkeleton class="h-7 w-2/3" />
          <USkeleton class="h-4 w-1/2" />
          <div class="mt-1 flex flex-wrap gap-2">
            <USkeleton class="h-5 w-20 rounded-full" />
            <USkeleton class="h-5 w-24 rounded-full" />
            <USkeleton class="h-5 w-28 rounded-full" />
          </div>
        </div>
      </div>
      <div class="lo-detail-body">
        <div class="lo-detail-main">
          <USkeleton class="h-72 rounded-2xl" />
          <USkeleton class="h-40 rounded-2xl" />
        </div>
        <div class="lo-detail-rail">
          <div class="flex flex-col gap-4">
            <USkeleton class="h-56 rounded-xl" />
            <USkeleton class="h-40 rounded-xl" />
          </div>
        </div>
      </div>
    </div>

    <UEmpty
      v-else-if="!title"
      size="lg"
      icon="i-lucide-file-question"
      title="没有找到这个行动"
      description="它可能已经被删除，或者链接不正确。"
    />

    <template v-else>
      <header class="border-b border-default pb-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 flex-1 items-start gap-4">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset"
              :class="typeMeta.tile"
            >
              <UIcon :name="typeMeta.icon" class="size-5" />
            </div>
            <div class="min-w-0">
              <NuxtLink
                :to="backTo"
                class="inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-default"
              >
                <UIcon name="i-lucide-arrow-left" class="size-3.5" />
                {{ typeMeta.navLabel }}列表
              </NuxtLink>
              <h1
                class="mt-1.5 line-clamp-2 break-words text-2xl font-semibold tracking-tight text-highlighted sm:text-[28px]"
                :title="title"
              >
                {{ title }}
              </h1>
              <p
                v-if="description"
                class="mt-1.5 line-clamp-2 break-words whitespace-pre-wrap text-sm leading-6 text-muted"
                :title="description"
              >
                {{ description }}
              </p>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <UBadge :color="statusColor(status)" variant="soft" class="gap-1.5">
                  <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {{ statusLabel(status) }}
                </UBadge>
                <UBadge :color="priorityColor(priority)" variant="subtle" class="gap-1">
                  <UIcon name="i-lucide-flag" class="size-3" />
                  优先级 {{ priorityLabel(priority) }}
                </UBadge>
                <slot name="meta" />
                <span class="inline-flex items-center gap-1.5">
                  <UIcon name="i-lucide-calendar-plus" class="size-3.5" />
                  {{ formatDateTime(createdAt) }} 创建
                </span>
                <span v-if="completedAt" class="inline-flex items-center gap-1.5">
                  <UIcon name="i-lucide-calendar-check" class="size-3.5" />
                  {{ formatDateTime(completedAt) }} 完成
                </span>
              </div>
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <slot name="actions" />
          </div>
        </div>
      </header>

      <div class="lo-detail-body">
        <div class="lo-detail-main">
          <slot name="main" />
        </div>
        <aside class="lo-detail-rail">
          <slot name="rail" />
        </aside>
      </div>
    </template>
  </UContainer>
</template>
