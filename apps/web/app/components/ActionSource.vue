<script setup lang="ts">
import type { ActionSourceLike } from '~/utils/action'

const props = withDefaults(
  defineProps<{
    source: ActionSourceLike | null
    /** 页面头部已经展示过的标题和描述,来源里不再重复 */
    title?: string | null
    description?: string | null
  }>(),
  { title: null, description: null },
)

const content = computed(() =>
  actionSourceContent(props.source, props.title, props.description),
)
</script>

<template>
  <div v-if="content.trigger || content.judgment" class="flex flex-col gap-4">
    <div v-if="content.trigger" class="flex flex-col gap-1.5">
      <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
        <UIcon name="i-lucide-radio" class="size-3.5" />
        触发内容
      </span>
      <div class="rounded-lg bg-elevated/50 px-3 py-2.5 ring-1 ring-default">
        <!-- eslint-disable-next-line vue/no-v-html -- 内容本身带 Markdown 格式,markdown-it 已转义原始 HTML -->
        <div class="lo-md text-sm text-muted" v-html="renderMarkdown(content.trigger)"></div>
      </div>
    </div>
    <div v-if="content.judgment" class="flex flex-col gap-1.5">
      <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
        <UIcon name="i-lucide-sparkles" class="size-3.5" />
        智能体判断
      </span>
      <div class="rounded-lg bg-default px-3 py-2.5 ring-1 ring-default">
        <!-- eslint-disable-next-line vue/no-v-html -- 同上 -->
        <div class="lo-md text-sm" v-html="renderMarkdown(content.judgment)"></div>
      </div>
    </div>
  </div>
</template>
