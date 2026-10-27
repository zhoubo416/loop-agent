<script setup lang="ts">
import type { MeetingImportSnapshot } from '~/utils/tencentMeeting'

interface SpeakerGroup {
  key: string
  speaker: string | null
  offsetMs: number | null
  text: string
}

const props = defineProps<{ snapshot: MeetingImportSnapshot }>()

const sourceText = computed(() => {
  const hasTime = props.snapshot.started_at || props.snapshot.ended_at
  const range = hasTime
    ? formatMeetingRange(props.snapshot.started_at, props.snapshot.ended_at)
    : ''
  return [range, meetingSourceLabel(props.snapshot.content_source)].filter(Boolean).join(' · ')
})

/**
 * 把逐字稿按连续发言人合并。start_ms 在不同来源里可能是相对偏移也可能是绝对时间,
 * 统一减掉第一段的起点,只展示相对时间。
 */
const speakerGroups = computed<SpeakerGroup[]>(() => {
  const segments = (props.snapshot.transcript_segments ?? []).filter((segment) =>
    segment.text?.trim(),
  )
  if (!segments.length) return []

  const starts = segments
    .map((segment) => segment.start_ms)
    .filter((value): value is number => typeof value === 'number')
  const base = starts.length ? Math.min(...starts) : null
  const groups: SpeakerGroup[] = []

  for (const segment of segments) {
    const speaker = segment.speaker?.trim() || null
    const text = segment.text.trim()
    const last = groups[groups.length - 1]
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${text}`.trim()
      continue
    }
    groups.push({
      key: `${groups.length}-${speaker ?? 'unknown'}`,
      speaker,
      offsetMs:
        base !== null && segment.start_ms !== null ? Math.max(0, segment.start_ms - base) : null,
      text,
    })
  }
  return groups
})

function initial(name: string | null): string {
  return (name ?? '?').trim().slice(0, 1) || '?'
}

function formatOffset(ms: number): string {
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <ActionPanel
      title="逐字稿"
      icon="i-lucide-file-text"
      :description="sourceText || '从腾讯会议导入的会议原文'"
    >
      <div v-if="speakerGroups.length" class="flex flex-col gap-5">
        <div v-for="group in speakerGroups" :key="group.key" class="flex gap-3">
          <UAvatar
            :text="initial(group.speaker)"
            :alt="group.speaker ?? '未知发言人'"
            size="sm"
            class="mt-0.5 shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium">{{ group.speaker ?? '未知发言人' }}</span>
              <span v-if="group.offsetMs !== null" class="text-[11px] text-muted">
                {{ formatOffset(group.offsetMs) }}
              </span>
            </div>
            <p class="mt-1 break-words whitespace-pre-wrap text-sm leading-7">{{ group.text }}</p>
          </div>
        </div>
      </div>

      <div
        v-else-if="snapshot.transcript"
        class="break-words whitespace-pre-wrap text-sm leading-7"
      >
        {{ snapshot.transcript }}
      </div>

      <UEmpty
        v-else
        variant="naked"
        size="sm"
        icon="i-lucide-file-text"
        title="没有导入逐字稿"
        description="这场会议没有可查看的逐字稿。"
      />

      <p
        v-if="snapshot.transcript || speakerGroups.length"
        class="mt-4 border-t border-default pt-3 text-xs leading-relaxed text-muted"
      >
        逐字稿只保存在 LOOP，不交给智能体。
      </p>
    </ActionPanel>

    <ActionPanel v-if="snapshot.todos.length" title="会议待办" icon="i-lucide-list-checks">
      <ul class="flex flex-col gap-2">
        <li v-for="(todo, index) in snapshot.todos" :key="index" class="flex gap-2 text-sm leading-7">
          <span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
          <span class="min-w-0 break-words">{{ todo }}</span>
        </li>
      </ul>
    </ActionPanel>
  </div>
</template>
