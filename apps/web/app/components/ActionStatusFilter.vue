<script setup lang="ts">
defineProps<{
  modelValue: string
  options: Array<{ label: string; value: string; count: number }>
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      v-for="option in options"
      :key="option.value"
      size="xs"
      :variant="modelValue === option.value ? 'solid' : 'outline'"
      :color="modelValue === option.value ? 'primary' : 'neutral'"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
      <span class="ml-1 tabular-nums opacity-70">{{ option.count }}</span>
    </UButton>
  </div>
</template>
