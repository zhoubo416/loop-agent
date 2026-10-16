<script setup lang="ts">
/**
 * 模型的推理过程(不是页面右侧那栏「思考结果」)。
 *
 * 默认收起:它比回答长得多,展开着会把回答顶下去。正文开始出现时由父组件收起一次,
 * 之后展开与否听用户的,不再自动改动。
 */
const open = defineModel<boolean>('open', { default: false })

defineProps<{
  text: string
  /** 还在生成:标签提示正在推理,内容跟着流式增长 */
  streaming?: boolean
}>()
</script>

<template>
  <UCollapsible v-model:open="open" class="mb-2 flex flex-col items-start">
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      class="-ml-2"
      :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
      :label="streaming ? '推理过程 · 正在推理…' : '推理过程'"
    />
    <template #content>
      <div
        class="mt-1 whitespace-pre-wrap break-words rounded-lg bg-elevated/60 px-3 py-2 text-xs text-muted"
      >
        {{ text }}
      </div>
    </template>
  </UCollapsible>
</template>
