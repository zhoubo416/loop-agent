import MarkdownIt from 'markdown-it'

// markdown-it 单例:默认不渲染原始 HTML,内容里的 HTML 一律转义
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

/** 把 Markdown 文本渲染成 HTML,交给 .lo-md 排版 */
export function renderMarkdown(content: string): string {
  return md.render(content)
}
