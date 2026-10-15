import type {
  AgentInput,
  AgentOutput,
  ConversationInput,
  OrganizeInput,
  OrganizeOutput,
} from './types.js'

export type AgentEngineErrorCode =
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_TIMEOUT'
  | 'ENGINE_AUTH_ERROR'
  | 'ENGINE_INVALID_OUTPUT'
  | 'ENGINE_RATE_LIMITED'
  | 'ENGINE_FORMAT_UNSUPPORTED'
  | 'ENGINE_EXECUTION_ERROR'

export class AgentEngineError extends Error {
  readonly code: AgentEngineErrorCode
  readonly retryable: boolean
  readonly details?: unknown

  constructor(code: AgentEngineErrorCode, message: string, options: { retryable?: boolean; details?: unknown } = {}) {
    super(message)
    this.name = 'AgentEngineError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

export interface ToolDescriptor {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * Agent Run 的工具执行上下文:Engine 拿到工具描述去生成 tool_calls,
 * 实际执行回调由 Runtime 提供(有数据库访问和 Project 作用域)。
 */
export interface AgentToolContext {
  descriptors: ToolDescriptor[]
  execute(name: string, args: Record<string, unknown>): Promise<unknown>
}

/**
 * Agent Engine 接口。Runtime 只认识这一个方法。
 * 对应 docs/design/07-agent-engine-adapter.md 第 4 节。
 */
export interface AgentEngine {
  readonly name: string
  run(input: AgentInput, tools?: AgentToolContext): Promise<AgentOutput>
  /** 对话模式:基于项目背景回答用户的问题,返回纯文本回复 */
  converse(input: ConversationInput): Promise<string>
  /** 整理模式:把资料文档文本整理成结构化草稿,不落库,由用户修订后提交 */
  organize(input: OrganizeInput): Promise<OrganizeOutput>
  healthCheck(): Promise<{ ok: boolean; detail?: string }>
}
