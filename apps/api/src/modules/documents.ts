import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../http/errors.js'
import { config } from '../config.js'
import type { Db, Row } from '../db/client.js'
import { extractDocumentText } from './extract.js'

/**
 * 资料(kind=document)行动的文档:上传的文件或 URL 链接。
 *
 * 文件字节保存在 UPLOAD_DIR/<projectId>/<documentId>,file_path 只存相对路径;
 * 提取出的文本保存在数据库里,对话和 AI 整理都读这份文本,不再碰原文件。
 */

export interface DocumentRow extends Row {
  id: string
  project_id: string
  action_id: string
  name: string
  source: 'upload' | 'url'
  mime_type: string | null
  file_path: string | null
  file_url: string | null
  file_size: number | string | null
  extracted_text: string | null
  parse_status: 'pending' | 'ok' | 'unsupported' | 'failed'
  parse_error: string | null
  uploaded_by: string | null
  created_at: Date | string
}

/** 列表用:不带 extracted_text 大字段,只带字符数 */
export interface DocumentListItem {
  id: string
  action_id: string
  name: string
  source: 'upload' | 'url'
  mime_type: string | null
  file_url: string | null
  file_size: number | string | null
  extracted_chars: number
  parse_status: DocumentRow['parse_status']
  parse_error: string | null
  created_at: Date | string
}

function documentFileLocation(projectId: string, documentId: string): { absolute: string; relative: string } {
  const relative = path.join(projectId, documentId)
  return { relative, absolute: path.join(config.uploadDir, relative) }
}

async function saveDocumentFile(projectId: string, documentId: string, buffer: Buffer): Promise<string> {
  const location = documentFileLocation(projectId, documentId)
  await fs.mkdir(path.dirname(location.absolute), { recursive: true })
  await fs.writeFile(location.absolute, buffer)
  return location.relative
}

async function removeDocumentFile(projectId: string, documentId: string): Promise<void> {
  const location = documentFileLocation(projectId, documentId)
  await fs.rm(location.absolute, { force: true })
}

/** 文件下载用的绝对路径,同时校验仍在 UPLOAD_DIR 内,防止相对路径越界 */
export function resolveDocumentFile(projectId: string, relativePath: string): string {
  const absolute = path.resolve(config.uploadDir, relativePath)
  const root = path.resolve(config.uploadDir)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new ApiError('DOCUMENT_FILE_INVALID', '文档文件路径不合法')
  }
  if (path.dirname(absolute) !== path.join(root, projectId)) {
    throw new ApiError('DOCUMENT_FILE_INVALID', '文档文件路径不合法')
  }
  return absolute
}

interface CreateDocumentInput {
  projectId: string
  actionId: string
  userId: string
  name: string
  mimeType: string | null
  fileSize: number
  buffer: Buffer
}

/** 上传文件:提取文本、落盘、入库。入库失败时尽力清理已写入的文件 */
export async function createUploadDocument(
  db: Db,
  input: CreateDocumentInput,
): Promise<DocumentRow> {
  const id = randomUUID()
  const parsed = await extractDocumentText(input.buffer, input.name)
  let filePath: string
  try {
    filePath = await saveDocumentFile(input.projectId, id, input.buffer)
  } catch (error) {
    throw new ApiError(
      'DOCUMENT_STORE_FAILED',
      `保存文件失败:${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    return await insertDocumentRow(db, {
      id,
      projectId: input.projectId,
      actionId: input.actionId,
      name: input.name,
      source: 'upload',
      mimeType: input.mimeType,
      filePath,
      fileUrl: null,
      fileSize: input.fileSize,
      extractedText: parsed.text,
      parseStatus: parsed.status,
      parseError: parsed.error,
      uploadedBy: input.userId,
    })
  } catch (error) {
    await removeDocumentFile(input.projectId, id).catch(() => {})
    throw error
  }
}

/** URL 导入:提取文本后只存元数据,不落盘字节 */
export async function createUrlDocument(
  db: Db,
  input: CreateDocumentInput & { url: string },
): Promise<DocumentRow> {
  const parsed = await extractDocumentText(input.buffer, input.name)
  return insertDocumentRow(db, {
    projectId: input.projectId,
    actionId: input.actionId,
    name: input.name,
    source: 'url',
    mimeType: input.mimeType,
    filePath: null,
    fileUrl: input.url,
    fileSize: input.fileSize,
    extractedText: parsed.text,
    parseStatus: parsed.status,
    parseError: parsed.error,
    uploadedBy: input.userId,
  })
}

interface InsertDocumentRowInput {
  id?: string
  projectId: string
  actionId: string
  name: string
  source: 'upload' | 'url'
  mimeType: string | null
  filePath: string | null
  fileUrl: string | null
  fileSize: number
  extractedText: string | null
  parseStatus: 'ok' | 'unsupported' | 'failed'
  parseError: string | null
  uploadedBy: string
}

async function insertDocumentRow(db: Db, input: InsertDocumentRowInput): Promise<DocumentRow> {
  const result = await db.query<DocumentRow>(
    `INSERT INTO action_documents
       (id, project_id, action_id, name, source, mime_type, file_path, file_url,
        file_size, extracted_text, parse_status, parse_error, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.projectId,
      input.actionId,
      input.name,
      input.source,
      input.mimeType,
      input.filePath,
      input.fileUrl,
      input.fileSize,
      input.extractedText,
      input.parseStatus,
      input.parseError,
      input.uploadedBy,
    ],
  )
  return result.rows[0]!
}

export async function listDocuments(
  db: Db,
  projectId: string,
  actionId: string,
): Promise<DocumentListItem[]> {
  const result = await db.query<DocumentListItem>(
    `SELECT id, action_id, name, source, mime_type, file_url, file_size,
            coalesce(length(extracted_text), 0) AS extracted_chars,
            parse_status, parse_error, created_at
     FROM action_documents
     WHERE project_id = $1 AND action_id = $2
     ORDER BY created_at, id`,
    [projectId, actionId],
  )
  return result.rows
}

/** 取带提取文本的完整记录,给对话上下文和 AI 整理用 */
export async function getDocumentTexts(
  db: Db,
  projectId: string,
  actionId: string,
): Promise<Array<{ id: string; name: string; extracted_text: string | null }>> {
  const result = await db.query<{
    id: string
    name: string
    extracted_text: string | null
  }>(
    `SELECT id, name, extracted_text FROM action_documents
     WHERE project_id = $1 AND action_id = $2 AND parse_status = 'ok'
     ORDER BY created_at, id`,
    [projectId, actionId],
  )
  return result.rows
}

export async function getDocument(
  db: Db,
  projectId: string,
  actionId: string,
  documentId: string,
): Promise<DocumentRow> {
  const result = await db.query<DocumentRow>(
    'SELECT * FROM action_documents WHERE id = $1 AND project_id = $2 AND action_id = $3',
    [documentId, projectId, actionId],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('DOCUMENT_NOT_FOUND', '文档不存在')
  return row
}

/** 删除文档:先删记录,再尽力清理文件 */
export async function deleteDocument(
  db: Db,
  projectId: string,
  actionId: string,
  documentId: string,
): Promise<void> {
  const row = await getDocument(db, projectId, actionId, documentId)
  await db.query('DELETE FROM action_documents WHERE id = $1', [row.id])
  if (row.file_path) await removeDocumentFile(projectId, row.id).catch(() => {})
}