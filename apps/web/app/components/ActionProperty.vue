<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex items-baseline gap-3 py-1.5">
    <dt class="w-16 shrink-0 text-xs text-muted">{{ label }}</dt>
    <dd class="min-w-0 flex-1 break-words text-sm leading-6 text-default">
      <slot />
    </dd>
  </div>
</template>
