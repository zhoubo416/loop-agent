<script setup lang="ts">
interface ActionSource {
  event: { id: string; type: string; title: string; content: string } | null
  recommendation: { id: string; content: string } | null
  run: {
    id: string
    trigger_type: string
    created_at: string
    judgment: string | null
    observation: { id: string; type: string; content: string } | null
  } | null
}

const props = defineProps<{ source: ActionSource | null }>()

// 触发信息优先取原始观察;没有观察时退回事件,再退回建议,避免同一件事重复展示
const trigger = computed(() => {
  const source = props.source
  if (source?.run?.observation) return source.run.observation.content
  if (source?.event) {
    return source.event.content && source.event.content !== source.event.title
      ? `${source.event.title}\n\n${source.event.content}`
      : source.event.title
  }
  return source?.recommendation?.content ?? null
})

const judgment = computed(() => props.source?.run?.judgment ?? null)

const hasSource = computed(() => Boolean(trigger.value || judgment.value))
</script>

<template>
  <UCard v-if="hasSource" class="lg:col-span-3" :ui="{ body: 'sm:p-3' }">
    <template #header>
      <span class="text-sm font-medium">来源</span>
    </template>
    <div class="flex flex-col gap-3">
      <div v-if="trigger">
        <span class="text-xs text-muted">触发信息</span>
        <!-- eslint-disable-next-line vue/no-v-html -- 内容本身带 Markdown 格式,markdown-it 已转义原始 HTML -->
        <div
          class="lo-md mt-1 max-h-40 overflow-y-auto text-sm text-muted"
          v-html="renderMarkdown(trigger)"
        ></div>
      </div>
      <div v-if="judgment">
        <span class="text-xs text-muted">智能体判断</span>
        <!-- eslint-disable-next-line vue/no-v-html -- 同上 -->
        <div class="lo-md mt-1 text-sm" v-html="renderMarkdown(judgment)"></div>
      </div>
    </div>
  </UCard>
</template>