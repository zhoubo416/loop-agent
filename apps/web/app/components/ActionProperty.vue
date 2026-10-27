<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
    <dt class="shrink-0 text-xs text-muted">{{ label }}</dt>
    <dd class="min-w-0 break-words text-right text-sm leading-6 text-default">
      <slot />
    </dd>
  </div>
</template>
