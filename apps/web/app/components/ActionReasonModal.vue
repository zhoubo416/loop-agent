<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    placeholder?: string
    confirmLabel?: string
    confirmColor?: 'warning' | 'error'
    /** 失败原因必填,取消原因可以留空 */
    requireReason?: boolean
    busy?: boolean
  }>(),
  {
    description: '',
    placeholder: '',
    confirmLabel: '确认',
    confirmColor: 'warning',
    requireReason: true,
    busy: false,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [reason: string]
}>()

const reason = ref('')

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const canConfirm = computed(
  () => !props.busy && (!props.requireReason || Boolean(reason.value.trim())),
)

watch(
  () => props.open,
  (open) => {
    if (open) reason.value = ''
  },
)

function submit() {
  if (!canConfirm.value) return
  emit('confirm', reason.value.trim())
  isOpen.value = false
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="title">
    <template #body>
      <div class="flex flex-col gap-3">
        <p v-if="description" class="text-sm leading-relaxed text-muted">{{ description }}</p>
        <UFormField :label="requireReason ? '原因' : '原因（可选）'">
          <UTextarea
            v-model="reason"
            :rows="3"
            :maxrows="6"
            autoresize
            class="w-full"
            :placeholder="placeholder"
            :disabled="busy"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" :disabled="busy" @click="isOpen = false">
        先不操作
      </UButton>
      <UButton :color="confirmColor" :loading="busy" :disabled="!canConfirm" @click="submit">
        {{ confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
