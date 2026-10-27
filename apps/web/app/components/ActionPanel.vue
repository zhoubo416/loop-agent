<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    /** 右栏用的紧凑面板,内边距更小 */
    compact?: boolean
  }>(),
  {
    title: '',
    description: '',
    icon: '',
    compact: false,
  },
)

const ui = computed(() =>
  props.compact
    ? {
        root: 'rounded-xl',
        header: 'px-4 py-3.5',
        body: 'px-4 py-4',
        footer: 'px-4 py-3.5',
      }
    : {
        root: 'rounded-2xl',
        header: 'px-5 py-4 sm:px-6',
        body: 'px-5 py-5 sm:px-6',
        footer: 'px-5 py-4 sm:px-6',
      },
)
</script>

<template>
  <UCard :ui="ui">
    <template v-if="title || $slots.actions" #header>
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <div
            v-if="icon"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"
          >
            <UIcon :name="icon" class="size-4" />
          </div>
          <div class="min-w-0">
            <h2 v-if="title" class="text-sm font-semibold text-highlighted">{{ title }}</h2>
            <p v-if="description" class="mt-0.5 text-xs leading-relaxed text-muted">
              {{ description }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <slot name="actions" />
        </div>
      </div>
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
