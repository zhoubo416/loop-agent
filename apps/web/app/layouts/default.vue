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
const currentProject = computed(
  () => (projects.value?.items ?? []).find((item) => item.id === currentProjectId.value) ?? null,
)

const { sessions, pending: sessionsPending } = useChatSessions(currentProjectId)

// 当前会话以 URL 为准,和 Chat 页共用同一条约定:带 session 参数就是那一段对话
const activeSessionId = computed(() => (route.query.session as string | undefined) || null)

// 「对话」接着最近一段聊,一段都没有时落到空白对话
const chatHref = computed(() => {
  const id = currentProjectId.value
  if (!id) return '/'
  const target = activeSessionId.value ?? sessions.value[0]?.id
  return target ? `/projects/${id}/chat?session=${target}` : `/projects/${id}/chat`
})

function projectSummary(project: ProjectItem): string {
  return [statusLabel(project.status), project.current_stage].filter(Boolean).join(' · ')
}

const projectMenuItems = computed(() => {
  const items = (projects.value?.items ?? []).map((project) => ({
    // 用 checkbox 项才能显示当前项目的勾选,勾选由 URL 决定,点击只做切换
    label: project.name,
    description: projectSummary(project),
    type: 'checkbox' as const,
    checked: project.id === currentProjectId.value,
    onSelect: () => {
      void navigateTo(`/projects/${project.id}`)
    },
  }))
  return [
    ...items,
    ...(items.length ? [{ type: 'separator' as const }] : []),
    { label: '全部项目', icon: 'i-lucide-layout-list', to: '/' },
    { label: '新建项目', icon: 'i-lucide-plus', to: '/?new=1' },
  ]
})

const navItems = computed(() => {
  const id = currentProjectId.value
  if (!id) return [{ label: '项目', to: '/' }]
  return [
    { label: '概览', to: `/projects/${id}` },
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

      <!-- 左上角:当前项目与项目切换 -->
      <UDropdownMenu :items="projectMenuItems" :content="{ align: 'start' }" class="w-full">
        <UButton color="neutral" variant="outline" block class="justify-between gap-2 py-2">
          <span class="flex min-w-0 flex-col items-start text-left">
            <span class="w-full truncate text-sm font-medium">
              {{ currentProject?.name ?? '选择项目' }}
            </span>
            <span class="w-full truncate text-xs text-muted">
              {{
                currentProject
                  ? projectSummary(currentProject)
                  : `${projects?.items.length ?? 0} 个项目`
              }}
            </span>
          </span>
          <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted" />
        </UButton>
      </UDropdownMenu>

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

      <!-- 对话:会话列表,在任意页面都能直接切到某一段讨论 -->
      <div v-if="currentProjectId" class="lo-sidebar-chat">
        <div class="flex items-center justify-between gap-2">
          <NuxtLink :to="chatHref" class="text-xs text-muted transition-colors hover:text-default">
            对话
          </NuxtLink>
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            :to="`/projects/${currentProjectId}/chat`"
            title="新对话"
            aria-label="新对话"
          />
        </div>

        <div class="lo-sidebar-sessions">
          <template v-if="sessionsPending && !sessions.length">
            <USkeleton v-for="n in 3" :key="n" class="h-12 shrink-0 rounded-lg" />
          </template>
          <template v-else>
            <NuxtLink
              v-for="session in sessions"
              :key="session.id"
              :to="`/projects/${currentProjectId}/chat?session=${session.id}`"
              class="rounded-lg px-2.5 py-2 text-sm transition-colors"
              :class="
                session.id === activeSessionId ? 'bg-primary/10 font-medium' : 'hover:bg-elevated/60'
              "
              :title="session.preview || '历史对话'"
            >
              <span class="line-clamp-2 break-words">{{ session.preview || '历史对话' }}</span>
              <span class="mt-0.5 block text-[11px] text-muted">
                {{ formatDateTime(session.created_at) }} · {{ session.message_count }} 条
              </span>
            </NuxtLink>
            <p v-if="!sessions.length" class="px-2.5 text-xs text-muted">还没有历史对话</p>
          </template>
        </div>
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
