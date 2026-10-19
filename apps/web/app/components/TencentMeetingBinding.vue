<script setup lang="ts">
import type { TencentMeetingIntegrationStatus } from '~/utils/tencentMeeting'

const props = withDefaults(
  defineProps<{
    /** 导入弹窗里用紧凑排版,设置页里用完整排版 */
    compact?: boolean
    /** Token 已失效时直接展开重新绑定表单 */
    forceForm?: boolean
  }>(),
  { compact: false, forceForm: false },
)

const emit = defineEmits<{
  bound: [status: TencentMeetingIntegrationStatus]
  unbound: []
  cancel: []
}>()

const api = useApi()

const { data: status, refresh, pending } = await useAsyncData(
  'tencent-meeting-integration',
  () => api.get<TencentMeetingIntegrationStatus>('/me/integrations/tencent-meeting'),
)

const token = ref('')
const rebindOpen = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

const showingForm = computed(
  () => props.forceForm || !status.value?.configured || rebindOpen.value,
)

function openRebind() {
  token.value = ''
  error.value = ''
  notice.value = ''
  rebindOpen.value = true
}

function cancelRebind() {
  rebindOpen.value = false
  if (props.forceForm) emit('cancel')
}

async function save() {
  if (busy.value) return
  const value = token.value.trim()
  if (!value) {
    error.value = '请先粘贴腾讯会议 Token'
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api.put<TencentMeetingIntegrationStatus>(
      '/me/integrations/tencent-meeting',
      { token: value },
    )
    status.value = result
    token.value = ''
    rebindOpen.value = false
    notice.value = '腾讯会议已绑定。'
    emit('bound', result)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

async function unbind() {
  if (busy.value) return
  if (!window.confirm('解除绑定后,导入会议内容需要重新绑定腾讯会议账号。确定解除吗?')) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.del('/me/integrations/tencent-meeting')
    await refresh()
    token.value = ''
    rebindOpen.value = false
    notice.value = '已解除腾讯会议绑定。'
    emit('unbound')
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" :class="props.compact ? 'text-sm' : ''">
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <UAlert v-if="notice" color="success" variant="soft" :title="notice" />

    <USkeleton v-if="pending && !status" class="h-10 rounded-lg" />

    <div v-else-if="status?.configured && !showingForm" class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="success" variant="soft">已绑定</UBadge>
          <span class="text-sm text-muted">{{ status.masked_token ?? '••••' }}</span>
        </div>
        <p class="mt-1 text-xs text-muted">绑定于 {{ formatDateTime(status.updated_at) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" color="neutral" variant="outline" :disabled="busy" @click="openRebind">
          重新绑定
        </UButton>
        <UButton size="xs" color="error" variant="ghost" :disabled="busy" @click="unbind">
          解除绑定
        </UButton>
      </div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        绑定你自己的腾讯会议账号，把会议纪要、参会人和逐字稿导入会议行动。个人版和专业版可用，企业版暂不支持。
      </p>
      <div>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          to="https://meeting.tencent.com/ai-skill"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开腾讯会议 AI Skill 页面
        </UButton>
      </div>
      <UFormField
        label="腾讯会议 Token"
        help="用个人账号登录后复制 Token；如果页面自动切到企业账号，先在右上角切回个人账号"
      >
        <UInput
          v-model="token"
          type="password"
          class="w-full"
          placeholder="粘贴在 AI Skill 页面复制的 Token"
          autocomplete="off"
        />
      </UFormField>
      <div class="flex flex-wrap items-center gap-2">
        <UButton :loading="busy" :disabled="busy" @click="save">保存并验证</UButton>
        <UButton
          v-if="status?.configured"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="cancelRebind"
        >
          取消
        </UButton>
      </div>
      <p class="text-xs text-muted">
        Token 只保存在 LOOP 服务端，浏览器拿不到原文；重新绑定会覆盖旧 Token。
      </p>
    </div>
  </div>
</template>
