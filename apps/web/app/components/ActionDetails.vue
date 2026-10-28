<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    icon?: string
    description?: string
  }>(),
  {
    title: '详情',
    icon: 'i-lucide-info',
    description: '',
  },
)
</script>

<template>
  <ActionPanel :title="title" :icon="icon" :description="description">
    <dl class="grid gap-x-10 gap-y-1 sm:grid-cols-2">
      <slot />
    </dl>
  </ActionPanel>
</template>
