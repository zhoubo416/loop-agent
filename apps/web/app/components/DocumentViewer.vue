<script setup lang="ts">
import { OpenFileViewer } from '@open-file-viewer/vue'
import {
  archivePlugin,
  fallbackPlugin,
  imagePlugin,
  officePlugin,
  pdfPlugin,
  textPlugin,
} from '@open-file-viewer/core'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import pdfLegacyWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

/**
 * Open File Viewer 封装。
 * 插件只取常用格式:图片、文本、PDF、Office、压缩包,其余落到下载兜底;
 * pdf.js worker 按官方 README 传双地址。这个组件的依赖很重,
 * 调用方通过 defineAsyncComponent 引入,让它只在首次预览时才加载。
 */
const plugins = [
  imagePlugin(),
  textPlugin(),
  pdfPlugin({ workerSrc: pdfWorkerSrc, legacyWorkerSrc: pdfLegacyWorkerSrc }),
  officePlugin(),
  archivePlugin(),
  fallbackPlugin(),
]

withDefaults(
  defineProps<{
    source: File | Blob | string
    name: string
    mimeType?: string | null
    height?: string
  }>(),
  { height: '72vh' },
)
</script>

<template>
  <ClientOnly>
    <OpenFileViewer
      :file="source"
      :file-name="name"
      :mime-type="mimeType ?? undefined"
      :plugins="plugins"
      width="100%"
      :height="height"
      fit="contain"
      toolbar
      theme="auto"
      locale="zh-CN"
    />
  </ClientOnly>
</template>