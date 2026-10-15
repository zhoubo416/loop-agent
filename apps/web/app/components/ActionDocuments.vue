<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

interface DocumentItem {
  id: string
  name: string
  source: 'upload' | 'url'
  mime_type: string | null
  file_url: string | null
  file_size: number | string | null
  extracted_chars: number
  parse_status: 'pending' | 'ok' | 'unsupported' | 'failed'
  parse_error: string | null
  created_at: string
}

// 预览组件依赖很重,异步引入让它在首次打开预览时才加载
const DocumentViewer = defineAsyncComponent(() => import('./DocumentViewer.vue'))

const props = defineProps<{
  projectId: string
  actionId: string
  documents: DocumentItem[]
  editable: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const api = useApi()
const busy = ref(false)
const error = ref('')
const notice = ref('')
const urlInput = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// 当前预览的文档:upload 来源先拉字节转 File,url 来源直接把链接交给预览组件
const previewDoc = ref<DocumentItem | null>(null)
const previewSource = ref<File | Blob | string | null>(null)
const previewPending = ref(false)

const parseStatusLabels: Record<DocumentItem['parse_status'], string> = {
  pending: '待解析',
  ok: '已解析',
  unsupported: '不支持解析',
  failed: '解析失败',
}

function parseStatusColor(status: DocumentItem['parse_status']): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ok') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'unsupported') return 'neutral'
  return 'warning'
}

function pickFiles() {
  fileInput.value?.click()
}

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || busy.value) return

  busy.value = true
  error.value = ''
  notice.value = ''
  const form = new FormData()
  for (const file of files) form.append('files', file)
  try {
    const result = await api.postForm<{ items: DocumentItem[] }>(
      `/projects/${props.projectId}/actions/${props.actionId}/documents/upload`,
      form,
    )
    notice.value = `已上传 ${result.items.length} 个文件`
    emit('refresh')
  } catch (caught) {
    error.value = (caught as Error).message || '上传失败'
  } finally {
    busy.value = false
  }
}

async function importUrl() {
  const url = urlInput.value.trim()
  if (!url || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/projects/${props.projectId}/actions/${props.actionId}/documents/import-url`, { url })
    urlInput.value = ''
    notice.value = '链接已导入'
    emit('refresh')
  } catch (caught) {
    error.value = (caught as Error).message || '导入失败'
  } finally {
    busy.value = false
  }
}

async function openPreview(doc: DocumentItem) {
  if (previewPending.value) return
  previewPending.value = true
  error.value = ''
  previewDoc.value = doc
  previewSource.value = null
  try {
    if (doc.source === 'url') {
      // URL 来源直接预览原链接;站点不允许跨域读取时组件会显示失败,可在新窗口打开
      previewSource.value = doc.file_url ?? ''
    } else {
      const blob = await api.getBlob(
        `/projects/${props.projectId}/actions/${props.actionId}/documents/${doc.id}/file`,
      )
      previewSource.value = new File([blob], doc.name, { type: doc.mime_type ?? undefined })
    }
  } catch (caught) {
    error.value = `预览加载失败:${(caught as Error).message}`
    previewDoc.value = null
  } finally {
    previewPending.value = false
  }
}

async function remove(doc: DocumentItem) {
  if (busy.value) return
  if (!window.confirm(`删除「${doc.name}」?`)) return
  busy.value = true
  error.value = ''
  try {
    await api.del(`/projects/${props.projectId}/actions/${props.actionId}/documents/${doc.id}`)
    notice.value = `已删除 ${doc.name}`
    emit('refresh')
  } catch (caught) {
    error.value = (caught as Error).message || '删除失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard class="lg:col-span-3">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-medium">文档</span>
        <div v-if="editable" class="flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-upload" size="sm" :loading="busy" @click="pickFiles">上传文件</UButton>
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onFilesPicked"
          />
        </div>
      </div>
    </template>

    <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-3" />
    <UAlert v-if="notice" color="success" variant="soft" :title="notice" class="mb-3" />

    <div v-if="editable" class="mb-3 flex flex-wrap items-center gap-2">
      <UInput
        v-model="urlInput"
        icon="i-lucide-link"
        placeholder="粘贴文件直链导入,如 https://…/报告.pdf"
        class="min-w-0 flex-1"
        :disabled="busy"
        @keydown.enter.prevent="importUrl"
      />
      <UButton icon="i-lucide-download" size="sm" color="neutral" variant="outline" :loading="busy" @click="importUrl">
        导入链接
      </UButton>
    </div>

    <div v-if="!documents.length" class="text-sm text-muted">
      还没有文档。上传本机文件或粘贴文件链接,智能体会读取文档文本,辅助对话和整理。
    </div>
    <ul v-else class="flex flex-col divide-y divide-default">
      <li v-for="doc in documents" :key="doc.id" class="flex flex-wrap items-center gap-2 py-2">
        <UIcon :name="doc.source === 'url' ? 'i-lucide-link' : 'i-lucide-file-text'" class="size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" :title="doc.name">{{ doc.name }}</p>
          <p class="text-xs text-muted">
            {{ doc.source === 'url' ? '链接' : '本机' }} · {{ formatSize(doc.file_size) }} ·
            {{ formatDateTime(doc.created_at) }}
          </p>
        </div>
        <UBadge
          :color="parseStatusColor(doc.parse_status)"
          variant="soft"
          :title="doc.parse_error ?? undefined"
        >
          {{ parseStatusLabels[doc.parse_status] }}
          <template v-if="doc.parse_status === 'ok' && doc.extracted_chars"> · {{ doc.extracted_chars }} 字</template>
        </UBadge>
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-eye"
          :loading="previewPending && previewDoc?.id === doc.id"
          @click="openPreview(doc)"
        >
          预览
        </UButton>
        <UButton
          v-if="doc.source === 'url' && doc.file_url"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-external-link"
          :to="doc.file_url"
          target="_blank"
          title="在新窗口打开"
        />
        <UButton
          v-if="editable"
          size="xs"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :disabled="busy"
          @click="remove(doc)"
        />
      </li>
    </ul>

    <UModal
      :open="Boolean(previewDoc)"
      :title="previewDoc?.name"
      class="max-w-none"
      :ui="{ content: 'max-w-6xl' }"
      @update:open="(value: boolean) => { if (!value) { previewDoc = null; previewSource = null } }"
    >
      <template #body>
        <div v-if="previewPending" class="flex h-[72vh] items-center justify-center text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          正在加载文档…
        </div>
        <DocumentViewer
          v-else-if="previewSource !== null"
          :source="previewSource"
          :name="previewDoc?.name ?? '文档'"
          :mime-type="previewDoc?.mime_type"
        />
      </template>
    </UModal>
  </UCard>
</template>