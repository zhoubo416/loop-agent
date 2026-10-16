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

  /**
   * 流式请求(SSE,带鉴权):每收到一个事件就回调一次,直到响应结束。
   *
   * POST 用不了 EventSource,所以这里直接读 fetch 的响应体。
   * 服务端在切开流之前失败时会返回普通 JSON 错误,按普通请求的错误抛出。
   */
  async function stream(
    path: string,
    body: unknown,
    onEvent: (event: string, data: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = await authHeaders()
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body ?? {}),
      ...(signal ? { signal } : {}),
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
      throw new Error(payload?.error?.message ?? `请求失败(${response.status})`)
    }
    if (!response.body) throw new Error('响应没有内容')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        for (let match = /\r?\n\r?\n/.exec(buffer); match; match = /\r?\n\r?\n/.exec(buffer)) {
          const raw = buffer.slice(0, match.index)
          buffer = buffer.slice(match.index + match[0].length)
          const lines = raw.split(/\r?\n/)
          const name = /^event:\s*(.*)$/.exec(lines[0] ?? '')?.[1] ?? 'message'
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('\n')
          if (!data) continue
          let payload: any
          try {
            payload = JSON.parse(data)
          } catch {
            continue // 单个事件解析不了就跳过,不打断整条流
          }
          onEvent(name, payload)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
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
    stream,
    base,
    tokenCookie,
    userIdCookie,
  }
}
