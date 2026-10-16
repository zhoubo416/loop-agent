import type { FastifyReply } from 'fastify'

/**
 * SSE 响应写入器。
 *
 * 在写出第一个事件之前不接管响应:这段时间里的失败仍然是普通的 JSON 错误响应,
 * 前端拿到的是正常的状态码和错误码;一旦切开 SSE,之后的失败只能以 error 事件收尾。
 * 这样"引擎还没开始回答就出错"这类最常见的问题不用变成流里的一句错误。
 */
export class SseStream {
  private started = false

  constructor(private readonly reply: FastifyReply) {}

  /** 是否已经切开 SSE:切开之前的失败还能走普通错误响应 */
  get isStarted(): boolean {
    return this.started
  }

  send(event: string, data: unknown): void {
    const raw = this.reply.raw
    if (!this.started) {
      this.started = true
      this.reply.hijack()
      // hijack 之后 Fastify 不再补自己收集的响应头,这里把已经设好的(CORS 等)带上
      for (const [name, value] of Object.entries(this.reply.getHeaders())) {
        if (value !== undefined) raw.setHeader(name, value)
      }
      raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      raw.setHeader('cache-control', 'no-cache, no-transform')
      raw.writeHead(200)
    }
    // 客户端可能已经断开:写之前确认连接还在
    if (raw.writableEnded || raw.destroyed) return
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  end(): void {
    if (!this.started) return
    const raw = this.reply.raw
    if (raw.writableEnded || raw.destroyed) return
    raw.end()
  }
}
