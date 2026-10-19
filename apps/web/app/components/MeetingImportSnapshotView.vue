<script setup lang="ts">
import type { MeetingImportSnapshot } from '~/utils/tencentMeeting'

const props = withDefaults(
  defineProps<{
    snapshot: MeetingImportSnapshot
    /** 编辑态只展示导入来源和逐字稿,纪要已经在表单里 */
    compact?: boolean
  }>(),
  { compact: false },
)

const showTranscript = ref(false)
</script>

<template>
  <div class="rounded-lg border border-default p-3">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p class="text-sm font-medium">已导入：{{ props.snapshot.meeting_title ?? '腾讯会议' }}</p>
        <p class="text-xs text-muted">
          {{ formatMeetingRange(props.snapshot.started_at, props.snapshot.ended_at) }}
          · {{ meetingSourceLabel(props.snapshot.content_source) }}
        </p>
      </div>
      <UButton
        v-if="props.snapshot.transcript"
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="showTranscript ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showTranscript = !showTranscript"
      >
        {{ showTranscript ? '收起逐字稿' : '查看逐字稿' }}
      </UButton>
    </div>

    <div v-if="!props.compact" class="mt-3 flex flex-col gap-3 text-sm">
      <p v-if="props.snapshot.summary">
        <span class="text-muted">结论：</span>{{ props.snapshot.summary }}
      </p>
      <p v-if="props.snapshot.participants.length">
        <span class="text-muted">参会人：</span>{{ props.snapshot.participants.join('、') }}
      </p>
      <div v-if="props.snapshot.minutes">
        <p class="text-xs font-medium text-muted">纪要</p>
        <p class="mt-0.5 whitespace-pre-wrap">{{ props.snapshot.minutes }}</p>
      </div>
    </div>

    <div
      v-if="props.snapshot.transcript && showTranscript"
      class="mt-2 max-h-64 overflow-y-auto rounded-lg bg-elevated/40 p-2 text-xs whitespace-pre-wrap"
    >
      {{ props.snapshot.transcript }}
    </div>
    <p v-if="props.snapshot.transcript" class="mt-1 text-xs text-muted">
      逐字稿只保存在 LOOP，不交给智能体。
    </p>
  </div>
</template>
