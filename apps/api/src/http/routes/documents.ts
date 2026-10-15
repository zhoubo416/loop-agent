import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../../db/client.js'
import { resolveUser } from '../auth.js'
import { requireProjectAccess } from '../../modules/access.js'
import { getAction, type ActionRow } from '../../modules/actions.js'
import {
  createUploadDocument,
  createUrlDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  resolveDocumentFile,
} from '../../modules/documents.js'
import { getEngine } from '../../agent/engine-factory.js'
import { buildOrganizeInput } from '../../agent/context-builder.js'
import { ApiError } from '../errors.js'
import { config } from '../../config.js'

export const uploadFilesLimit = 10

const importUrlSchema = z.object({
  url: z.string().min(1).max(2000),
  name: z.string().min(1).max(500).optional(),
})

const organizeSchema = z.object({
  instruction: z.string().max(2000).optional(),
})

/** 上传和删除只在行动未结束时开放,避免资料提交后再悄悄变化 */
async function requireEditableDocumentAction(
  projectId: string,
  actionId: string,
): Promise<ActionRow> {
  const action = await getAction(getDb(), projectId, actionId)
  if (action.kind !== 'document') {
    throw new ApiError('ACTION_KIND_MISMATCH', '只有资料行动才有文档')
  }
  if (!['pending', 'running'].includes(action.status)) {
    throw new ApiError('ACTION_INVALID_STATE', '行动已结束,不能再修改文档')
  }
  return action
}

/** 从 URL 抓取内容,受超时和大小上限约束 */
async function fetchUrlBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string | null }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError('DOCUMENT_URL_INVALID', '只支持 http/https 链接')
  }

  let response: Response
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(config.urlImportTimeoutMs) })
  } catch (error) {
    throw new ApiError(
      'DOCUMENT_URL_INVALID',
      `链接抓取失败:${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new ApiError('DOCUMENT_URL_INVALID', `链接返回 ${response.status}`)
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > config.uploadMaxBytes) {
    throw new ApiError('DOCUMENT_TOO_LARGE', '文件超过大小上限')
  }

  // 流式读取并在超限时中止,避免没有 content-length 的响应把内存吃满
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError('DOCUMENT_URL_INVALID', '链接没有返回内容')
  const chunks: Buffer[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value!.byteLength
    if (received > config.uploadMaxBytes) {
      await reader.cancel().catch(() => {})
      throw new ApiError('DOCUMENT_TOO_LARGE', '文件超过大小上限')
    }
    chunks.push(Buffer.from(value!))
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || null
  return { buffer: Buffer.concat(chunks), mimeType }
}

/** URL 导入时没有显式名称就从链接里取,再不行给个兜底 */
function nameFromUrl(url: string): string {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    const base = path.basename(pathname).trim()
    if (base) return base.slice(0, 500)
  } catch {
    // 解析失败走兜底
  }
  return '未命名文档'
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function registerDocumentRoutes(app: FastifyInstance): void {
  /** 上传本机文件:multipart,字段名 files,可多选 */
  app.post('/api/v1/projects/:projectId/actions/:actionId/documents/upload', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await requireEditableDocumentAction(projectId, actionId)

    if (!request.isMultipart()) {
      throw new ApiError('VALIDATION_ERROR', '上传必须使用 multipart/form-data')
    }

    // 先把所有文件读完再入库:任何一个文件超限或数量超限,都不留下部分成功的结果
    const collected: Array<{ name: string; mimeType: string | null; buffer: Buffer }> = []
    try {
      for await (const part of request.files()) {
        if (part.fieldname !== 'files') continue
        const name = path.basename(part.filename || '未命名文件').slice(0, 500)
        collected.push({ name, mimeType: part.mimetype || null, buffer: await part.toBuffer() })
      }
    } catch (error) {
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
        throw new ApiError('DOCUMENT_TOO_LARGE', '有文件超过单文件大小上限')
      }
      if (error instanceof app.multipartErrors.FilesLimitError) {
        throw new ApiError('VALIDATION_ERROR', `一次最多上传 ${uploadFilesLimit} 个文件`)
      }
      throw error
    }
    if (collected.length === 0) {
      throw new ApiError('VALIDATION_ERROR', '没有收到文件,字段名需要是 files')
    }

    const db = getDb()
    const items = []
    for (const file of collected) {
      items.push(
        await createUploadDocument(db, {
          projectId,
          actionId,
          userId: user.id,
          name: file.name,
          mimeType: file.mimeType,
          fileSize: file.buffer.byteLength,
          buffer: file.buffer,
        }),
      )
    }
    reply.status(201)
    return { items }
  })

  /** 从 URL 导入:只提取文本和元数据,不保存文件字节,预览时直接用原链接 */
  app.post('/api/v1/projects/:projectId/actions/:actionId/documents/import-url', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await requireEditableDocumentAction(projectId, actionId)
    const body = importUrlSchema.parse(request.body ?? {})

    const { buffer, mimeType } = await fetchUrlBuffer(body.url)
    const document = await createUrlDocument(getDb(), {
      projectId,
      actionId,
      userId: user.id,
      name: (body.name ?? nameFromUrl(body.url)).slice(0, 500),
      mimeType,
      fileSize: buffer.byteLength,
      buffer,
      url: body.url,
    })
    reply.status(201)
    return document
  })

  /** 文件内容:只对上传来源有效,URL 来源直接预览原链接 */
  app.get('/api/v1/projects/:projectId/actions/:actionId/documents/:documentId/file', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, actionId, documentId } = request.params as {
      projectId: string
      actionId: string
      documentId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id)
    const document = await getDocument(getDb(), projectId, actionId, documentId)
    if (!document.file_path) {
      throw new ApiError('DOCUMENT_FILE_INVALID', '这个文档来自链接,没有本地文件')
    }
    const absolute = resolveDocumentFile(projectId, document.file_path)
    let stat
    try {
      stat = await fs.stat(absolute)
    } catch {
      throw new ApiError('DOCUMENT_FILE_INVALID', '文件已不存在')
    }
    if (!stat.isFile()) throw new ApiError('DOCUMENT_FILE_INVALID', '文档文件路径不合法')

    reply.header('content-type', document.mime_type || 'application/octet-stream')
    reply.header('content-length', stat.size)
    reply.header('content-disposition', contentDisposition(document.name))
    return reply.send(createReadStream(absolute))
  })

  app.delete('/api/v1/projects/:projectId/actions/:actionId/documents/:documentId', async (request, reply) => {
    const user = await resolveUser(request)
    const { projectId, actionId, documentId } = request.params as {
      projectId: string
      actionId: string
      documentId: string
    }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    await requireEditableDocumentAction(projectId, actionId)
    await deleteDocument(getDb(), projectId, actionId, documentId)
    reply.status(204)
    return null
  })

  /** AI 整理:基于文档文本生成结论/要点/内容草稿,不落库,由用户修订后随 complete 提交 */
  app.post('/api/v1/projects/:projectId/actions/:actionId/organize', async (request) => {
    const user = await resolveUser(request)
    const { projectId, actionId } = request.params as { projectId: string; actionId: string }
    await requireProjectAccess(getDb(), projectId, user.id, 'member')
    const action = await getAction(getDb(), projectId, actionId)
    if (action.kind !== 'document') {
      throw new ApiError('ACTION_KIND_MISMATCH', '只有资料行动才能 AI 整理')
    }
    const body = organizeSchema.parse(request.body ?? {})

    const input = await buildOrganizeInput(getDb(), projectId, action, body.instruction)
    const draft = await getEngine().organize(input)
    return { summary: draft.summary, key_points: draft.keyPoints, content: draft.content }
  })
}