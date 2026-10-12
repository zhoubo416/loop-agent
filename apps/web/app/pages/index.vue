<script setup lang="ts">
interface ProjectItem {
  id: string
  name: string
  objective: string
  status: string
  current_stage: string | null
  updated_at: string
}

const api = useApi()
const { data, refresh, pending } = await useAsyncData('project-list', () =>
  api.get<{ items: ProjectItem[]; total: number }>('/projects'),
)

const form = reactive({ name: '', objective: '', description: '' })
const submitting = ref(false)
const error = ref('')
const showForm = ref(false)

async function createProject() {
  error.value = ''
  if (!form.name.trim() || !form.objective.trim()) {
    error.value = '名称和目标都不能为空'
    return
  }
  submitting.value = true
  try {
    const project = await api.post<{ id: string }>('/projects', {
      name: form.name,
      objective: form.objective,
      ...(form.description ? { description: form.description } : {}),
    })
    await navigateTo(`/projects/${project.id}`)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UContainer>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">项目</h1>
        <p class="text-muted">每个项目都是一个持续运行的智能体。</p>
      </div>
      <UButton
        :color="showForm ? 'neutral' : 'primary'"
        :variant="showForm ? 'outline' : 'solid'"
        @click="showForm = !showForm"
      >
        {{ showForm ? '取消' : '新建项目' }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

    <UCard v-if="showForm" class="mb-6">
      <template #header>
        <span class="font-medium">新建项目</span>
      </template>
      <div class="flex flex-col gap-4">
        <UFormField label="名称" required>
          <UInput v-model="form.name" placeholder="蛋白 X 机制研究" class="w-full" />
        </UFormField>
        <UFormField label="目标" help="这个智能体为什么存在" required>
          <UInput
            v-model="form.objective"
            placeholder="验证蛋白 X 是否影响肿瘤细胞增殖。"
            class="w-full"
          />
        </UFormField>
        <UFormField label="描述">
          <UTextarea v-model="form.description" :rows="3" class="w-full" />
        </UFormField>
        <div>
          <UButton :loading="submitting" @click="createProject">创建并进入</UButton>
        </div>
      </div>
    </UCard>

    <div class="flex flex-col gap-3">
      <NuxtLink
        v-for="project in data?.items ?? []"
        :key="project.id"
        :to="`/projects/${project.id}`"
      >
        <UCard
          class="transition hover:ring-primary/40"
          :ui="{ body: 'sm:p-4' }"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="truncate font-medium">{{ project.name }}</div>
              <div class="text-sm text-muted">{{ project.objective }}</div>
              <div class="mt-1 text-xs text-muted">
                阶段:{{ project.current_stage || '未开始' }} · 更新于
                {{ formatDateTime(project.updated_at) }}
              </div>
            </div>
            <UBadge :color="statusColor(project.status)" variant="soft">
              {{ statusLabel(project.status) }}
            </UBadge>
          </div>
        </UCard>
      </NuxtLink>
    </div>

    <UAlert
      v-if="!(data?.items ?? []).length && !showForm && !pending"
      class="mt-4"
      color="neutral"
      variant="soft"
      title="还没有项目"
      description="先创建一个,让智能体开始工作。"
    />
  </UContainer>
</template>
