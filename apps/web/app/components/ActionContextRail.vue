<script setup lang="ts">
import type { ActionAnalysisItem, ActionExecution, ActionSourceLike } from '~/utils/action'

const props = withDefaults(
  defineProps<{
    analysis: ActionAnalysisItem[]
    executions: ActionExecution[]
    source: ActionSourceLike | null
    title?: string | null
    description?: string | null
    sourceHeading?: string
    sourceHint?: string | null
  }>(),
  {
    title: null,
    description: null,
    sourceHeading: '来源',
    sourceHint: null,
  },
)

const sourceContent = computed(() =>
  actionSourceContent(props.source, props.title, props.description),
)
const hasSource = computed(() =>
  Boolean(sourceContent.value.trigger || sourceContent.value.judgment),
)
const sortedAnalysis = computed(() => [...props.analysis].reverse())

const sourceOpen = ref(false)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
        <UIcon name="i-lucide-sparkles" class="size-3.5" />
        智能体
      </span>
      <span class="h-px flex-1 bg-default" />
    </div>

    <ActionPanel
      title="智能体分析"
      icon="i-lucide-sparkles"
      description="结果交给智能体后，它据此做出的判断、记录的事件和建议。"
      compact
    >
      <ActionAnalysis v-if="analysis.length" :analysis="sortedAnalysis" />
      <p v-else class="text-sm leading-relaxed text-muted">
        还没有分析。这个行动的结果交给智能体后，它的判断、事件和建议会出现在这里。
      </p>
    </ActionPanel>

    <ActionPanel title="执行记录" icon="i-lucide-history" compact>
      <ExecutionList :executions="executions" />
    </ActionPanel>

    <ActionPanel v-if="hasSource" compact>
      <UCollapsible v-model:open="sourceOpen">
        <UButton color="neutral" variant="ghost" block class="justify-between px-0">
          <span class="flex items-center gap-2 text-sm font-semibold text-highlighted">
            <UIcon name="i-lucide-git-branch" class="size-4 text-muted" />
            {{ sourceHeading }}
          </span>
          <UIcon
            :name="sourceOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-muted"
          />
        </UButton>
        <template #content>
          <p v-if="sourceHint" class="mt-1 text-xs leading-relaxed text-muted">{{ sourceHint }}</p>
          <div class="pt-3">
            <ActionSource :source="source" :title="title" :description="description" />
          </div>
        </template>
      </UCollapsible>
    </ActionPanel>
  </div>
</template>
