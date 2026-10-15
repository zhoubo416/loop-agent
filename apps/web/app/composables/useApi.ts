export interface ApiErrorPayload {
  error: { code: string; message: string; details?: unknown }
}

export function useApi() {
  const config = useRuntimeConfig()
  const base = config.public.apiBase as string
  const configuredUserId = config.public.userId as string

  const tokenCookie = useCookie<string | null>('loop_token')
  const userIdCookie = useCookie<string | null>('loop_user_id')

  async function authHeaders(): Promise<Record<string, string>> {
    if (tokenCookie.value) return { authorization: `Bearer ${tokenCookie.value}` }
    if (configuredUserId) return { 'x-user-id': configuredUserId }
    if (userIdCookie.value) return { 'x-user-id': userIdCookie.value }

    // 开发环境:没有登录时自动拿到开发用户
    try {
      const dev = await $fetch<{ id: string }>(`${base}/dev-login`, { method: 'POST' })
      userIdCookie.value = dev.id
      return { 'x-user-id': dev.id }
    } catch {
      return {}
    }
  }

  async function request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
  ): Promise<T> {
    try {
      const headers = await authHeaders()
      return (await $fetch(`${base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: options.body as Record<string, unknown> }),
      })) as T
    } catch (error) {
      const payload = (error as { data?: ApiErrorPayload }).data
      throw new Error(payload?.error?.message ?? (error as Error).message ?? '请求失败')
    }
  }

  /** 拉取二进制内容(带鉴权),文档预览用 */
  async function getBlob(path: string): Promise<Blob> {
    const headers = await authHeaders()
    return $fetch(`${base}${path}`, { headers, responseType: 'blob' })
  }

  /** 提交 multipart 表单(带鉴权),文件上传用 */
  async function postForm<T>(path: string, form: FormData): Promise<T> {
    const headers = await authHeaders()
    return $fetch(`${base}${path}`, { method: 'POST', headers, body: form }) as Promise<T>
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    getBlob,
    postForm,
    base,
    tokenCookie,
    userIdCookie,
  }
}
