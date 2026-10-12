<script setup lang="ts">
interface ProjectItem {
  id: string
  name: string
  status: string
  current_stage: string | null
}

const api = useApi()
const route = useRoute()

const { data: projects, refresh } = await useAsyncData('layout-projects', () =>
  api.get<{ items: ProjectItem[] }>('/projects'),
)

const { data: unread, refresh: refreshUnread } = await useAsyncData(
  'unread-count',
  () => api.get<{ count: number }>('/notifications/unread-count'),
)

const currentProjectId = computed(() => route.params.id as string | undefined)

const navItems = computed(() => {
  const id = currentProjectId.value
  if (!id) return [{ label: '项目', to: '/' }]
  return [
    { label: '概览', to: `/projects/${id}` },
    { label: '对话', to: `/projects/${id}/chat` },
    { label: '时间线', to: `/projects/${id}/timeline` },
    { label: '行动', to: `/projects/${id}/actions` },
    { label: '设置', to: `/projects/${id}/settings` },
  ]
})

watch(
  () => route.fullPath,
  () => {
    if (!route.params.id) void refresh()
    void refreshUnread()
  },
)

function logout() {
  api.tokenCookie.value = null
  api.userIdCookie.value = null
  window.location.href = '/'
}
</script>

<template>
  <div class="lo-shell flex min-h-screen">
    <aside class="lo-sidebar">
      <NuxtLink to="/" class="block">
        <div class="text-lg font-semibold tracking-widest">LOOP</div>
        <div class="text-xs text-muted">一个项目,就是一个智能体</div>
      </NuxtLink>

      <NuxtLink
        to="/notifications"
        class="flex items-center justify-between rounded-lg border border-default px-3 py-2 text-sm hover:bg-elevated"
      >
        <span>通知</span>
        <UBadge v-if="(unread?.count ?? 0) > 0" color="primary" variant="soft">
          {{ unread?.count }}
        </UBadge>
      </NuxtLink>

      <UNavigationMenu :items="navItems" orientation="vertical" />

      <div class="flex flex-col gap-2">
        <div class="text-xs text-muted">我的项目</div>
        <UButton
          v-for="project in projects?.items ?? []"
          :key="project.id"
          :to="`/projects/${project.id}`"
          :variant="project.id === currentProjectId ? 'soft' : 'ghost'"
          color="neutral"
          block
          class="justify-start"
        >
          <span class="flex min-w-0 flex-col items-start text-left">
            <span class="truncate text-sm font-medium">{{ project.name }}</span>
            <span class="text-xs text-muted">
              {{ statusLabel(project.status) }}
              <template v-if="project.current_stage"> · {{ project.current_stage }}</template>
            </span>
          </span>
        </UButton>
        <div v-if="!(projects?.items ?? []).length" class="text-xs text-muted">还没有项目</div>
      </div>

      <div class="mt-auto flex items-center justify-between border-t border-default pt-4">
        <NuxtLink v-if="!api.tokenCookie.value" to="/login" class="text-sm text-muted hover:text-default">
          登录
        </NuxtLink>
        <UButton
          v-else
          size="xs"
          color="neutral"
          variant="ghost"
          @click="logout"
        >
          退出登录
        </UButton>
      </div>
    </aside>

    <main class="lo-main">
      <slot />
    </main>
  </div>
</template>
