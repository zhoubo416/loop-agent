<script setup lang="ts">
import type { ActionListItem } from '~/composables/useActionList'

const props = defineProps<{ projectId: string }>()

const projectId = computed(() => props.projectId)
const api = useApi()

const { items, refresh, pending } = await useActionList(projectId, 'document')
const { pendingId, error, confirm, decline } = useActionOps(projectId, refresh)

type Group = 'open' | 'proposed' | 'completed' | 'all'
// 资料库默认展示全部,方便浏览已经整理过的材料
const group = ref<Group>('all')

function inGroup(action: ActionListItem, value: Group): boolean {
  if (value === 'all') return true
  if (value === 'open') return ['pending', 'running'].includes(action.status)
  return action.status === value
}

const counts = computed(() => ({
  open: items.value.filter((item) => ['pending', 'running'].includes(item.status)).length,
  proposed: items.value.filter((item) => item.status === 'proposed').length,
  completed: items.value.filter((item) => item.status === 'completed').length,
  all: items.value.length,
}))

const groupOptions = computed(() => [
  { label: '全部', value: 'all', count: counts.value.all },
  { label: '整理中', value: 'open', count: counts.value.open },
  { label: '待确认', value: 'proposed', count: counts.value.proposed },
  { label: '已整理', value: 'completed', count: counts.value.completed },
])

function timestamp(value?: string | null): number {
  return value ? new Date(value).getTime() : 0
}

const filtered = computed(() =>
  items.value
    .filter((item) => inGroup(item, group.value))
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at)),
)

function namesText(action: ActionListItem): string {
  const docs = action.documents
  if (!docs || !docs.names.length) return ''
  return docs.count > docs.names.length ? `${docs.names.join('、')} 等` : docs.names.join('、')
}

function titleFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || '整理资料'
}

const uploadBusy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function pickFiles() {
  fileInput.value?.click()
}

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || uploadBusy.value) return

  const first = files[0]
  if (!first) return
  const title =
    files.length === 1
      ? titleFromFile(first.name)
      : `${titleFromFile(first.name)} 等 ${files.length} 个文件`

  uploadBusy.value = true
  error.value = ''
  try {
    const created = await api.post<{ id: string }>(`/projects/${projectId.value}/actions`, {
      title,
      kind: 'document',
      priority: 'medium',
    })
    const form = new FormData()
    for (const file of files) form.append('files', file)
    try {
      await api.postForm(`/projects/${projectId.value}/actions/${created.id}/documents/upload`, form)
    } catch (caught) {
      await refresh()
      error.value = `资料整理「${title}」已创建,但文件上传失败:${(caught as Error).message}。打开它重新上传即可。`
      return
    }
    await navigateTo(`/projects/${projectId.value}/documents/${created.id}`)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    uploadBusy.value = false
  }
}

const createOpen = ref(false)
const createBusy = ref(false)
const createForm = reactive({ title: '', description: '' })

async function create() {
  if (createBusy.value) return
  if (!createForm.title.trim()) {
    error.value = '标题不能为空'
    return
  }
  createBusy.value = true
  error.value = ''
  try {
    const created = await api.post<{ id: string }>(`/projects/${projectId.value}/actions`, {
      title: createForm.title,
      kind: 'document',
      priority: 'medium',
      description: createForm.description || null,
    })
    createOpen.value = false
    createForm.title = ''
    createForm.description = ''
    await navigateTo(`/projects/${projectId.value}/documents/${created.id}`)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    createBusy.value = false
  }
}
</script>

<template>
  <UContainer>
    <div class="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">资料库</h1>
        <p class="text-sm text-muted">
          每条记录是一次资料整理:上传文件或导入链接,整理完交给智能体。
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="refresh()">刷新</UButton>
        <UButton color="neutral" variant="outline" @click="createOpen = true">新建整理</UButton>
        <UButton icon="i-lucide-upload" :loading="uploadBusy" @click="pickFiles">上传资料</UButton>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked" />
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

    <div class="mb-3">
      <ActionStatusFilter v-model="group" :options="groupOptions" />
    </div>

    <div v-if="pending && !items.length" class="flex flex-col gap-3">
      <USkeleton v-for="n in 4" :key="n" class="h-28 rounded-lg" />
    </div>
    <div v-else class="flex flex-col gap-3">
      <UCard v-for="action in filtered" :key="action.id" :ui="{ body: 'sm:p-3' }">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <NuxtLink
            :to="actionDetailPath(projectId, action)"
            class="min-w-0 flex-1 break-words font-medium hover:underline"
          >
            {{ action.title }}
          </NuxtLink>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <UBadge :color="statusColor(action.status)" variant="soft">
              {{ statusLabel(action.status) }}
            </UBadge>
          </div>
        </div>

        <div v-if="action.documents && action.documents.count" class="mt-1 flex flex-col gap-1">
          <p class="break-words text-sm">
            <span class="text-muted">{{ action.documents.count }} 个文档 ·</span>
            {{ namesText(action) }}
          </p>
          <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <UBadge v-if="action.documents.parsed_count" color="success" variant="soft">
              已解析 {{ action.documents.parsed_count }}
            </UBadge>
            <UBadge v-if="action.documents.unsupported_count" color="neutral" variant="soft">
              不支持 {{ action.documents.unsupported_count }}
            </UBadge>
            <UBadge v-if="action.documents.failed_count" color="error" variant="soft">
              解析失败 {{ action.documents.failed_count }}
            </UBadge>
            <span v-if="action.documents.extracted_chars">
              共 {{ action.documents.extracted_chars }} 字
            </span>
          </div>
        </div>
        <p v-else class="mt-1 text-sm text-muted">还没有上传文件。</p>

        <p v-if="action.result?.summary" class="mt-1 line-clamp-2 break-words text-sm">
          <span class="text-muted">整理结论:</span>{{ action.result.summary }}
        </p>
        <p v-else-if="action.description" class="mt-1 line-clamp-2 break-words text-sm text-muted">
          {{ action.description }}
        </p>

        <div v-if="action.status === 'proposed'" class="mt-2 flex flex-wrap items-center gap-2">
          <UButton
            size="xs"
            :loading="pendingId === action.id"
            :disabled="pendingId !== null"
            @click="confirm(action.id)"
          >
            确认
          </UButton>
          <UButton
            size="xs"
            color="error"
            variant="ghost"
            :disabled="pendingId !== null"
            @click="decline(action.id)"
          >
            拒绝
          </UButton>
        </div>
        <div v-else class="mt-2 flex flex-wrap items-center gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            :to="actionDetailPath(projectId, action)"
          >
            {{ action.status === 'completed' ? '查看结果' : '打开整理' }}
          </UButton>
          <UButton
            v-if="action.documents && action.documents.count"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-message-circle"
            :to="`/projects/${projectId}/chat?doc=${action.id}`"
          >
            去对话
          </UButton>
        </div>
      </UCard>
    </div>

    <p v-if="!pending && !filtered.length" class="mt-3 text-sm text-muted">
      这个范围内没有资料整理记录。
    </p>

    <UModal v-model:open="createOpen" title="新建整理">
      <template #body>
        <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />
        <div class="flex flex-col gap-4">
          <UFormField label="标题" required>
            <UInput v-model="createForm.title" class="w-full" placeholder="这次要整理哪些资料" />
          </UFormField>
          <UFormField label="描述">
            <UTextarea
              v-model="createForm.description"
              :rows="3"
              class="w-full"
              placeholder="想从资料里得到什么,可留空"
            />
          </UFormField>
          <p class="text-sm text-muted">创建后进入详情页,在那里上传文件或导入链接。</p>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="createOpen = false">取消</UButton>
        <UButton :loading="createBusy" @click="create">创建并打开</UButton>
      </template>
    </UModal>
  </UContainer>
</template>
