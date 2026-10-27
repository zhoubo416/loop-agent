<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { ActionDocumentItem } from '~/utils/action'

// 预览组件依赖很重,异步引入让它在首次打开预览时才加载
const DocumentViewer = defineAsyncComponent(() => import('./DocumentViewer.vue'))

const props = defineProps<{
  projectId: string
  actionId: string
  documents: ActionDocumentItem[]
  editable: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const api = useApi()
const busy = ref(false)
const error = ref('')
const notice = ref('')
const urlInput = ref('')
const importOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)

// 当前预览的文档:upload 来源先拉字节转 File,url 来源直接把链接交给预览组件
const previewDoc = ref<ActionDocumentItem | null>(null)
const previewSource = ref<File | Blob | string | null>(null)
const previewPending = ref(false)
const deletingDoc = ref<ActionDocumentItem | null>(null)

const parsedCount = computed(
  () => props.documents.filter((doc) => doc.parse_status === 'ok').length,
)
const totalChars = computed(() =>
  props.documents.reduce((sum, doc) => sum + (doc.extracted_chars || 0), 0),
)
const summary = computed(() => {
  if (!props.documents.length) return '还没有文档'
  const parts = [`${props.documents.length} 个文档`, `${parsedCount.value} 份已解析`]
  if (totalChars.value) parts.push(`共 ${totalChars.value.toLocaleString('zh-CN')} 字`)
  return parts.join(' · ')
})

const parseStatusLabels: Record<ActionDocumentItem['parse_status'], string> = {
  pending: '待解析',
  ok: '已解析',
  unsupported: '不支持解析',
  failed: '解析失败',
}

function parseStatusColor(
  status: ActionDocumentItem['parse_status'],
): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ok') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'unsupported') return 'neutral'
  return 'warning'
}

function fileIcon(doc: ActionDocumentItem): string {
  if (doc.source === 'url') return 'i-lucide-link'
  const mime = doc.mime_type ?? ''
  const name = doc.name.toLowerCase()
  if (mime.startsWith('image/')) return 'i-lucide-file-image'
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'i-lucide-file-text'
  if (mime.includes('spreadsheet') || mime.includes('excel') || /\.(xlsx?|csv)$/.test(name)) {
    return 'i-lucide-file-spreadsheet'
  }
  if (mime.includes('presentation') || /\.(pptx?)$/.test(name)) return 'i-lucide-file-presentation'
  if (mime.startsWith('video/')) return 'i-lucide-file-video'
  if (mime.startsWith('audio/')) return 'i-lucide-file-audio'
  return 'i-lucide-file-text'
}

function fileTone(doc: ActionDocumentItem): string {
  if (doc.source === 'url') return 'bg-secondary/10 text-secondary'
  const mime = doc.mime_type ?? ''
  const name = doc.name.toLowerCase()
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'bg-error/10 text-error'
  if (mime.includes('spreadsheet') || /\.(xlsx?|csv)$/.test(name)) return 'bg-success/10 text-success'
  if (mime.startsWith('image/')) return 'bg-warning/10 text-warning'
  return 'bg-info/10 text-info'
}

function pickFiles() {
  if (!props.editable || busy.value) return
  fileInput.value?.click()
}

async function uploadFiles(files: File[]) {
  if (!files.length || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  dragActive.value = false
  const form = new FormData()
  for (const file of files) form.append('files', file)
  try {
    const result = await api.postForm<{ items: ActionDocumentItem[] }>(
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

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void uploadFiles(files)
}

function onDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  void uploadFiles(files)
}

function openImport() {
  error.value = ''
  importOpen.value = true
}

async function importUrl() {
  const url = urlInput.value.trim()
  if (!url || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/projects/${props.projectId}/actions/${props.actionId}/documents/import-url`, {
      url,
    })
    urlInput.value = ''
    importOpen.value = false
    notice.value = '链接已导入'
    emit('refresh')
  } catch (caught) {
    error.value = (caught as Error).message || '导入失败'
  } finally {
    busy.value = false
  }
}

async function openPreview(doc: ActionDocumentItem) {
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

function askRemove(doc: ActionDocumentItem) {
  error.value = ''
  deletingDoc.value = doc
}

async function confirmRemove() {
  const doc = deletingDoc.value
  if (!doc || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api.del(`/projects/${props.projectId}/actions/${props.actionId}/documents/${doc.id}`)
    notice.value = `已删除 ${doc.name}`
    deletingDoc.value = null
    emit('refresh')
  } catch (caught) {
    error.value = (caught as Error).message || '删除失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ActionPanel title="文档" icon="i-lucide-files" :description="summary">
    <template #actions>
      <UButton
        v-if="editable"
        icon="i-lucide-link"
        size="sm"
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="openImport"
      >
        导入链接
      </UButton>
    </template>

    <div class="flex flex-col gap-4">
      <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :title="error" />
      <UAlert v-if="notice" color="success" variant="soft" icon="i-lucide-check" :title="notice" />

      <button
        v-if="editable"
        type="button"
        class="flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed"
        :class="
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-default hover:border-primary/40 hover:bg-elevated/40'
        "
        :disabled="busy"
        @click="pickFiles"
        @dragover.prevent
        @dragenter.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="onDrop"
      >
        <span class="flex size-10 items-center justify-center rounded-full bg-elevated text-muted">
          <UIcon
            :name="busy ? 'i-lucide-loader-circle' : 'i-lucide-cloud-upload'"
            class="size-5"
            :class="busy ? 'animate-spin' : ''"
          />
        </span>
        <span class="mt-2 text-sm font-medium">
          {{ busy ? '正在上传…' : '拖拽文件到这里，或点击上传' }}
        </span>
        <span class="mt-0.5 text-xs text-muted">支持 PDF、Word、Markdown 等，可多选</span>
      </button>
      <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked" />

      <UEmpty
        v-if="!documents.length && !editable"
        variant="naked"
        size="sm"
        icon="i-lucide-file-x"
        title="没有文档"
        description="这次整理没有上传或导入文档。"
      />
      <p v-else-if="!documents.length" class="text-center text-xs text-muted">
        上传后可以在这里预览、查看解析状态，也可以导入文件链接。
      </p>

      <ul v-else class="flex flex-col divide-y divide-default">
        <li
          v-for="doc in documents"
          :key="doc.id"
          class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg"
            :class="fileTone(doc)"
          >
            <UIcon :name="fileIcon(doc)" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium" :title="doc.name">{{ doc.name }}</p>
            <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <span>{{ doc.source === 'url' ? '链接' : '本机' }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ formatSize(doc.file_size) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ formatDateTime(doc.created_at) }}</span>
            </p>
          </div>
          <UBadge
            class="shrink-0"
            :color="parseStatusColor(doc.parse_status)"
            variant="soft"
            :title="doc.parse_error ?? undefined"
          >
            {{ parseStatusLabels[doc.parse_status] }}
            <template v-if="doc.parse_status === 'ok' && doc.extracted_chars">
              · {{ doc.extracted_chars }} 字
            </template>
          </UBadge>
          <div class="flex shrink-0 items-center gap-0.5">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-eye"
              title="预览"
              aria-label="预览"
              :loading="previewPending && previewDoc?.id === doc.id"
              @click="openPreview(doc)"
            />
            <UButton
              v-if="doc.source === 'url' && doc.file_url"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-external-link"
              :to="doc.file_url"
              target="_blank"
              title="在新窗口打开"
              aria-label="在新窗口打开"
            />
            <UButton
              v-if="editable"
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              title="删除"
              aria-label="删除"
              :disabled="busy"
              @click="askRemove(doc)"
            />
          </div>
        </li>
      </ul>
    </div>
  </ActionPanel>

  <UModal v-model:open="importOpen" title="导入链接">
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField label="文件直链" help="支持 PDF、Word、Markdown 等可直接下载的链接">
          <UInput
            v-model="urlInput"
            icon="i-lucide-link"
            placeholder="https://…/报告.pdf"
            class="w-full"
            :disabled="busy"
            @keydown.enter.prevent="importUrl"
          />
        </UFormField>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="importOpen = false">取消</UButton>
      <UButton :loading="busy" :disabled="!urlInput.trim()" @click="importUrl">导入</UButton>
    </template>
  </UModal>

  <UModal
    :open="Boolean(deletingDoc)"
    title="删除文档"
    @update:open="(value: boolean) => { if (!value) deletingDoc = null }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <p class="text-sm leading-relaxed text-muted">
          删除「{{ deletingDoc?.name }}」后，智能体将不再读取这份文档。这个操作不能撤销。
        </p>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" @click="deletingDoc = null">先不删</UButton>
      <UButton color="error" :loading="busy" @click="confirmRemove">删除</UButton>
    </template>
  </UModal>

  <UModal
    :open="Boolean(previewDoc)"
    :title="previewDoc?.name"
    class="max-w-none"
    :ui="{ content: 'max-w-6xl' }"
    @update:open="
      (value: boolean) => {
        if (!value) {
          previewDoc = null
          previewSource = null
        }
      }
    "
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
</template>
