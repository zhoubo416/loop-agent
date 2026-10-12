<script setup lang="ts">
const api = useApi()
const mode = ref<'login' | 'register'>('login')
const form = reactive({ email: '', password: '', name: '' })
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (!form.email || !form.password) {
    error.value = '邮箱和密码不能为空'
    return
  }
  if (mode.value === 'register' && !form.name.trim()) {
    error.value = '名字不能为空'
    return
  }
  busy.value = true
  try {
    const endpoint = mode.value === 'register' ? '/auth/register' : '/auth/login'
    const body =
      mode.value === 'register'
        ? { email: form.email, password: form.password, name: form.name }
        : { email: form.email, password: form.password }
    const result = await $fetch<{ token: string; user: { id: string; name: string; email: string } }>(
      `${api.base}${endpoint}`,
      { method: 'POST', body },
    )
    api.tokenCookie.value = result.token
    api.userIdCookie.value = null
    await navigateTo('/')
  } catch (caught) {
    const payload = (caught as { data?: ApiErrorPayload }).data
    error.value = payload?.error?.message ?? (caught as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-md pt-16">
    <div class="mb-8 text-center">
      <div class="text-2xl font-semibold tracking-widest">LOOP</div>
      <div class="text-sm text-muted">一个项目,就是一个智能体</div>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-medium">{{ mode === 'login' ? '登录' : '注册' }}</span>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            @click="mode = mode === 'login' ? 'register' : 'login'"
          >
            {{ mode === 'login' ? '没有账号?去注册' : '已有账号?去登录' }}
          </UButton>
        </div>
      </template>

      <UAlert v-if="error" color="error" variant="soft" :title="error" class="mb-4" />

      <div class="flex flex-col gap-4">
        <UFormField v-if="mode === 'register'" label="名字">
          <UInput v-model="form.name" class="w-full" placeholder="你的名字" />
        </UFormField>
        <UFormField label="邮箱">
          <UInput v-model="form.email" type="email" class="w-full" placeholder="you@example.com" />
        </UFormField>
        <UFormField label="密码" :help="mode === 'register' ? '至少 8 位' : ''">
          <UInput v-model="form.password" type="password" class="w-full" />
        </UFormField>
        <UButton block :loading="busy" @click="submit">
          {{ mode === 'login' ? '登录' : '注册并登录' }}
        </UButton>
      </div>
    </UCard>
  </UContainer>
</template>
