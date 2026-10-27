<script setup lang="ts">
import type { ActionDetailBase, ActionDocumentItem } from '~/utils/action'

interface DocumentDetail extends ActionDetailBase {
  documents: ActionDocumentItem[]
}

const route = useRoute()
const api = useApi()
const projectId = computed(() => route.params.id as string)
const actionId = computed(() => route.params.actionId as string)

const { data: action, refresh, pending, error: loadError } = await useAsyncData(
  () => `document-${actionId.value}`,
  () => api.get<DocumentDetail>(`/projects/${projectId.value}/actions/${actionId.value}`),
)

const {
  busy,
  error: lifecycleError,
  notice,
  complete,
  fail,
  cancel,
} = useActionLifecycle(projectId, actionId, refresh, { confirmCancel: false })

const {
  pendingId,
  error: opsError,
  confirm,
  decline,
} = useActionOps(projectId, refresh)

const organizeError = ref('')
const pageError = computed(
  () =>
    loadError.value?.message || lifecycleError.value || opsError.value || organizeError.value,
)

const summary = ref('')
const keyPoints = ref('')
const content = ref('')
const organizing = ref(false)
const failOpen = ref(false)
const cancelOpen = ref(false)

const editable = computed(() => ['pending', 'running'].includes(action.value?.status ?? ''))
const proposed = computed(() => action.value?.status === 'proposed')
const documents = computed(() => action.value?.documents ?? [])
const parsedCount = computed(
  () => documents.value.filter((doc) => doc.parse_status === 'ok').length,
)
const totalChars = computed(() =>
  documents.value.reduce((sum, doc) => sum + (doc.extracted_chars || 0), 0),
)
const chatHref = computed(() => `/projects/${projectId.value}/chat?doc=${actionId.value}`)

const description = computed(() => {
  const value = action.value?.description
  return value && !isSameText(value, action.value?.title) ? value : null
})

const longDescription = computed(() => {
  const value = description.value
  return Boolean(value && (value.length > 80 || value.includes('\n')))
})

// 编辑中还没有文档时先落在文档标签,其余情况先看整理内容
const tab = ref<'content' | 'documents'>(
  ['pending', 'running'].includes(action.value?.status ?? '') && !documents.value.length
    ? 'documents'
    : 'content',
)

const tabs = computed(() => [
  { label: '整理内容', value: 'content', icon: 'i-lucide-notebook-pen' },
  {
    label: '文档',
    value: 'documents',
    icon: 'i-lucide-files',
    badge: documents.value.length || undefined,
  },
])

const moreActions = computed(() => [
  {
    label: '标记失败',
    icon: 'i-lucide-circle-x',
    onSelect: () => {
      failOpen.value = true
    },
  },
  {
    label: '取消整理',
    icon: 'i-lucide-ban',
    color: 'error' as const,
    onSelect: () => {
      cancelOpen.value = true
    },
  },
])

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function submit() {
  void complete(
    { key_points: lines(keyPoints.value), content: content.value },
    summary.value.trim() || '资料已整理',
  )
}

/** AI 整理:把文档文本交给智能体生成草稿,用户检查修订后再提交 */
async function organize() {
  if (organizing.value) return
  organizing.value = true
  organizeError.value = ''
  try {
    const draft = await api.post<{ summary: string; key_points: string[]; content: string }>(
      `/projects/${projectId.value}/actions/${actionId.value}/organize`,
      {},
    )
    summary.value = draft.summary
    keyPoints.value = draft.key_points.join('\n')
    content.value = draft.content
    notice.value = 'AI 已整理出草稿，请检查修订后再提交。'
  } catch (caught) {
    organizeError.value = (caught as Error).message
  } finally {
    organizing.value = false
  }
}
</script>

<template>
  <div>
    <ActionDetailLayout
      kind="document"
      :loading="pending && !action"
      :title="action?.title"
      :description="description"
      :status="action?.status"
      :priority="action?.priority"
      :back-to="`/projects/${projectId}/documents`"
      :created-at="action?.created_at"
      :completed-at="action?.completed_at"
      :error="pageError"
      :notice="notice"
    >
      <template #meta>
        <template v-if="action">
          <span v-if="documents.length" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-files" class="size-3.5" />
            {{ documents.length }} 个文档
          </span>
          <span v-if="documents.length" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-circle-check" class="size-3.5" />
            {{ parsedCount }} 份已解析
          </span>
          <span v-if="totalChars" class="inline-flex items-center gap-1.5">
            <UIcon name="i-lucide-text" class="size-3.5" />
            共 {{ totalChars.toLocaleString('zh-CN') }} 字
          </span>
        </template>
      </template>

      <template #actions>
        <template v-if="proposed">
          <UButton
            color="error"
            variant="ghost"
            :disabled="pendingId !== null"
            @click="decline(actionId)"
          >
            拒绝
          </UButton>
          <UButton
            :loading="pendingId === actionId"
            :disabled="pendingId !== null"
            @click="confirm(actionId)"
          >
            确认整理
          </UButton>
        </template>
        <template v-else>
          <UButton
            v-if="documents.length"
            :to="chatHref"
            icon="i-lucide-message-circle"
            size="sm"
            color="neutral"
            variant="ghost"
          >
            去对话
          </UButton>
          <UButton
            v-if="editable"
            icon="i-lucide-files"
            size="sm"
            color="neutral"
            variant="outline"
            @click="tab = 'documents'"
          >
            管理文档
          </UButton>
        </template>
      </template>

      <template #main>
        <template v-if="action">
          <div class="flex flex-col gap-4">
            <UTabs v-model="tab" :items="tabs" variant="link" :content="false" />

            <template v-if="tab === 'content'">
              <ActionPanel
                v-if="description && longDescription"
                title="资料说明"
                icon="i-lucide-align-left"
              >
                <p class="break-words whitespace-pre-wrap text-sm leading-7 text-default">
                  {{ description }}
                </p>
              </ActionPanel>

              <ActionPanel
                v-if="proposed"
                title="等待确认"
                icon="i-lucide-clock"
                description="这是智能体提议的资料整理，确认后才进入整理阶段。"
              >
                <p class="text-sm leading-relaxed text-muted">
                  确认后可以上传文档、导入链接并整理内容；拒绝后这条记录不会再出现在整理中的列表里。
                </p>
              </ActionPanel>

              <ActionPanel
                v-else-if="editable"
                title="整理内容"
                icon="i-lucide-notebook-pen"
                description="把资料整理成结论、要点和正文，完成后交给智能体。"
              >
                <template #actions>
                  <UButton
                    icon="i-lucide-sparkles"
                    size="xs"
                    color="secondary"
                    variant="outline"
                    :loading="organizing"
                    :disabled="busy"
                    @click="organize()"
                  >
                    AI 整理
                  </UButton>
                </template>

                <div class="flex flex-col gap-5">
                  <UFormField label="结论" help="一句话概括这份资料说明了什么">
                    <UTextarea
                      v-model="summary"
                      :rows="3"
                      :maxrows="6"
                      autoresize
                      class="w-full"
                      placeholder="一句话概括这份资料，AI 整理会自动填充"
                    />
                  </UFormField>
                  <UFormField label="要点" help="每行一条">
                    <UTextarea
                      v-model="keyPoints"
                      :rows="4"
                      :maxrows="10"
                      autoresize
                      class="w-full"
                      placeholder="这份资料最重要的几条结论"
                    />
                  </UFormField>
                  <UFormField label="内容">
                    <UTextarea
                      v-model="content"
                      :rows="8"
                      :maxrows="20"
                      autoresize
                      class="w-full"
                      placeholder="整理后的正文，AI 整理会自动填充"
                    />
                  </UFormField>
                </div>

                <template #footer>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <UDropdownMenu :items="moreActions">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        trailing-icon="i-lucide-chevron-down"
                        :disabled="busy"
                      >
                        更多
                      </UButton>
                    </UDropdownMenu>
                    <UButton :loading="busy" @click="submit">完成并交给智能体</UButton>
                  </div>
                </template>
              </ActionPanel>

              <ActionPanel
                v-else
                :title="action.status === 'completed' ? '整理结果' : '资料状态'"
                icon="i-lucide-clipboard-check"
              >
                <ActionResult
                  :status="action.status"
                  kind="document"
                  :executions="action.executions"
                  summary-label="结论"
                />
              </ActionPanel>
            </template>

            <ActionDocuments
              v-else
              :project-id="projectId"
              :action-id="actionId"
              :documents="documents"
              :editable="editable"
              @refresh="refresh()"
            />
          </div>
        </template>
      </template>

      <template #rail>
        <ActionContextRail
          v-if="action"
          :analysis="action.analysis"
          :executions="action.executions"
          :source="action.source"
          :title="action.title"
          :description="action.description"
          details-title="资料信息"
          source-heading="为什么整理这份资料"
          source-hint="智能体当时看到的内容，以及它决定创建这份资料的原因。"
        >
          <template #details>
            <ActionProperty label="状态">
              <UBadge :color="statusColor(action.status)" variant="soft">
                {{ statusLabel(action.status) }}
              </UBadge>
            </ActionProperty>
            <ActionProperty label="优先级">
              <span class="inline-flex items-center gap-1">
                <UIcon name="i-lucide-flag" class="size-3.5" />
                {{ priorityLabel(action.priority) }}
              </span>
            </ActionProperty>
            <ActionProperty v-if="documents.length" label="文档数">
              {{ documents.length }} 个
            </ActionProperty>
            <ActionProperty v-if="documents.length" label="已解析">
              {{ parsedCount }} 份
            </ActionProperty>
            <ActionProperty v-if="totalChars" label="总字数">
              {{ totalChars.toLocaleString('zh-CN') }} 字
            </ActionProperty>
            <ActionProperty label="执行者">{{ executorLabel(action.executor_type) }}</ActionProperty>
            <ActionProperty label="创建时间">{{ formatDateTime(action.created_at) }}</ActionProperty>
            <ActionProperty v-if="action.completed_at" label="完成时间">
              {{ formatDateTime(action.completed_at) }}
            </ActionProperty>
          </template>
        </ActionContextRail>
      </template>
    </ActionDetailLayout>

    <ActionReasonModal
      v-model:open="failOpen"
      title="标记整理失败"
      description="失败原因会交给智能体，它会据此调整下一步。"
      placeholder="比如:资料无法解析，内容不足以整理"
      confirm-label="标记失败"
      confirm-color="warning"
      :busy="busy"
      @confirm="(reason) => fail(reason)"
    />

    <ActionReasonModal
      v-model:open="cancelOpen"
      title="取消整理"
      description="取消原因可留空。取消后这条记录不会再出现在整理中的列表里，智能体也会收到通知。"
      placeholder="比如:这份资料已经不再需要整理"
      confirm-label="取消整理"
      confirm-color="error"
      :require-reason="false"
      :busy="busy"
      @confirm="(reason) => cancel(reason || undefined)"
    />
  </div>
</template>
