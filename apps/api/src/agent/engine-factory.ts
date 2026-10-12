import { config } from '../config.js'
import type { AgentEngine } from './engine.js'
import { PIAgentEngine } from './engines/pi-engine.js'

let engine: AgentEngine | undefined
let override: AgentEngine | undefined

export function createEngine(name = config.agentEngine): AgentEngine {
  switch (name) {
    case 'pi':
    case 'openai':
      return new PIAgentEngine({
        baseUrl: config.agentEngineBaseUrl,
        apiKey: config.agentEngineApiKey,
        model: config.agentEngineModel,
        timeoutMs: config.agentEngineTimeoutMs,
        maxRetries: config.agentEngineMaxRetries,
      })
    default:
      throw new Error(`未知的 Agent Engine:${name},当前只支持 pi`)
  }
}

export function getEngine(): AgentEngine {
  if (override) return override
  if (!engine) engine = createEngine()
  return engine
}

/** 测试用:替换掉全局 Engine */
export function setEngine(next: AgentEngine | undefined): void {
  override = next
}
