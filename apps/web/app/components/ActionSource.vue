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

const hasSource = computed(() => {
  const source = props.source
  if (!source) return false
  return Boolean(source.event || source.recommendation || source.run?.observation || source.run?.judgment)
})
</script>

<template>
  <UCard v-if="hasSource" class="lg:col-span-3" :ui="{ body: 'sm:p-3' }">
    <template #header>
      <span class="text-sm font-medium">来源</span>
    </template>
    <div class="flex flex-col gap-1.5 text-sm">
      <div v-if="source?.run?.observation">
        <span class="text-muted">由这条信息触发:</span>
        {{ source.run.observation.content }}
      </div>
      <div v-if="source?.event">
        <span class="text-muted">事件:</span>
        {{ source.event.title }}
        <span v-if="source.event.content && source.event.content !== source.event.title">
          — {{ source.event.content }}
        </span>
      </div>
      <div v-if="source?.recommendation">
        <span class="text-muted">建议:</span>
        {{ source.recommendation.content }}
      </div>
      <div v-if="source?.run?.judgment">
        <span class="text-muted">智能体判断:</span>
        {{ source.run.judgment }}
      </div>
    </div>
  </UCard>
</template>
