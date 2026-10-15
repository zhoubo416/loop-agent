import JSZip from 'jszip'
import mammoth from 'mammoth'
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf'
import { config } from '../config.js'

/**
 * 服务端文档文本提取。
 *
 * 只求把文档里"人能读的字"提出来交给智能体,不求还原排版:
 * PDF 用 pdf.js,docx 用 mammoth,xlsx/pptx 直接解压取 XML 文本节点,
 * 纯文本类按 UTF-8 读取。其余格式(图片等)标记为 unsupported,
 * 智能体只能看到文件名和用户整理的内容。
 */

export type ParseStatus = 'ok' | 'unsupported' | 'failed'

export interface ExtractResult {
  status: ParseStatus
  text: string | null
  error: string | null
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'ini', 'conf',
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** 解码 XML 里的常用实体,够从 Office XML 里取文本用 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 取出一段 XML 里指定标签的文本内容 */
function tagContents(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const values: string[] = []
  for (const match of xml.matchAll(pattern)) {
    const text = decodeXmlEntities(match[1] ?? '').trim()
    if (text) values.push(text)
  }
  return values
}

/** 文件名里的数字序号,slide2 必须排在 slide10 前面 */
function numericSuffix(name: string): number {
  const match = /(\d+)\D*$/.exec(name)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const parts: string[] = []

  const sharedStrings = zip.file('xl/sharedStrings.xml')
  if (sharedStrings) {
    parts.push(tagContents(await sharedStrings.async('string'), 't').join(' '))
  }

  const sheets = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b))
  for (const name of sheets) {
    const xml = await zip.file(name)!.async('string')
    // t="s" 的单元格 <v> 是共享字符串的序号,不是内容,先剔掉再取剩余的 <v>(数字、公式结果)
    const xmlNoShared = xml.replace(/<c\b[^>]*\bt="s"[^>]*>[\s\S]*?<\/c>/g, '')
    const values = tagContents(xmlNoShared, 'v')
    const inline = tagContents(xml, 'is').flatMap((inner) => tagContents(inner, 't'))
    const cells = [...values, ...inline]
    if (cells.length) parts.push(cells.join(' '))
  }
  return parts.filter(Boolean).join('\n')
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b))
  const parts: string[] = []
  for (const name of slides) {
    const xml = await zip.file(name)!.async('string')
    const texts = tagContents(xml, 'a:t')
    if (texts.length) parts.push(texts.join(' '))
  }
  return parts.filter(Boolean).join('\n')
}

function extractPlainText(buffer: Buffer): string | null {
  // 文本文件被误标成二进制时,按空字节占比识别出来,避免把乱码交给智能体
  const sample = buffer.subarray(0, 8000)
  let nulls = 0
  for (const byte of sample) {
    if (byte === 0) nulls += 1
  }
  if (nulls / Math.max(1, sample.length) > 0.01) return null
  return buffer.toString('utf8').replace(/^﻿/, '')
}

function truncate(text: string): string {
  const max = config.documentTextMaxChars
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…(文本过长,已截断)`
}

export async function extractDocumentText(buffer: Buffer, name: string): Promise<ExtractResult> {
  const extension = extensionOf(name)
  try {
    let text: string | null = null
    if (extension === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      text = (await extractPdfText(pdf, { mergePages: true })).text
    } else if (extension === 'docx') {
      text = (await mammoth.extractRawText({ buffer })).value
    } else if (extension === 'xlsx') {
      text = await extractXlsxText(buffer)
    } else if (extension === 'pptx') {
      text = await extractPptxText(buffer)
    } else if (TEXT_EXTENSIONS.has(extension)) {
      text = extractPlainText(buffer)
      if (text === null) {
        return { status: 'unsupported', text: null, error: '内容不是有效文本' }
      }
    } else {
      return { status: 'unsupported', text: null, error: `不支持的格式:.${extension || '未知'}` }
    }

    const cleaned = text?.trim()
    if (!cleaned) return { status: 'ok', text: null, error: null }
    return { status: 'ok', text: truncate(cleaned), error: null }
  } catch (error) {
    return {
      status: 'failed',
      text: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}