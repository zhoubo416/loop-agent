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
    detailsTitle?: string
    participants?: string[]
  }>(),
  {
    title: null,
    description: null,
    sourceHeading: '来源',
    sourceHint: null,
    detailsTitle: '详情',
    participants: () => [],
  },
)

const sourceContent = computed(() =>
  actionSourceContent(props.source, props.title, props.description),
)
const hasSource = computed(() =>
  Boolean(sourceContent.value.trigger || sourceContent.value.judgment),
)
const sortedAnalysis = computed(() => [...props.analysis].reverse())
const participantList = computed(() =>
  Array.from(new Set(props.participants.map((name) => name.trim()).filter(Boolean))),
)

const historyOpen = ref(false)
const sourceOpen = ref(false)

function initial(name: string): string {
  return name.trim().slice(0, 1)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <ActionPanel :title="detailsTitle" icon="i-lucide-info" compact>
      <dl class="flex flex-col divide-y divide-default">
        <slot name="details" />
      </dl>
    </ActionPanel>

    <ActionPanel v-if="participantList.length" title="参会人" icon="i-lucide-users" compact>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="name in participantList"
          :key="name"
          class="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-xs text-default"
        >
          <UAvatar :text="initial(name)" :alt="name" size="3xs" />
          {{ name }}
        </span>
      </div>
    </ActionPanel>

    <ActionPanel
      v-if="analysis.length"
      title="智能体分析"
      icon="i-lucide-sparkles"
      description="结果交给智能体后，它据此做出的判断、记录的事件和建议。"
      compact
    >
      <ActionAnalysis :analysis="sortedAnalysis" />
    </ActionPanel>

    <ActionPanel v-if="executions.length" compact>
      <UCollapsible v-model:open="historyOpen">
        <UButton color="neutral" variant="ghost" block class="justify-between px-0">
          <span class="flex items-center gap-2 text-sm font-semibold text-highlighted">
            <UIcon name="i-lucide-history" class="size-4 text-muted" />
            执行记录
            <span class="text-xs font-normal text-muted">{{ executions.length }} 次</span>
          </span>
          <UIcon
            :name="historyOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-4 text-muted"
          />
        </UButton>
        <template #content>
          <div class="pt-3">
            <ExecutionList :executions="executions" />
          </div>
        </template>
      </UCollapsible>
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
