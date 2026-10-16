import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { createEngine } from '../src/agent/engine-factory.js'
import { AgentEngineError } from '../src/agent/engine.js'
import { PIAgentEngine } from '../src/agent/engines/pi-engine.js'
import { parseAgentOutput, parseOrganizeOutput } from '../src/agent/output-validator.js'
import { config } from '../src/config.js'
import type { AgentInput, ConversationInput } from '../src/agent/types.js'

const enabled = process.env.LOOP_REAL_ENGINE_TEST === '1'

/**
 * 真实 Agent Engine 的连通性测试。
 *
 * 它需要网络和有效的 AGENT_ENGINE_API_KEY,默认不跑:
 *   LOOP_REAL_ENGINE_TEST=1 npm run api:test
 */
test(
  '真实 Agent Engine 可以返回符合协议的结构化输出',
  { skip: enabled ? false : '未设置 LOOP_REAL_ENGINE_TEST=1,跳过真实 Engine 测试' },
  async () => {
    assert.ok(config.agentEngineApiKey, '需要配置 AGENT_ENGINE_API_KEY')

    const input: AgentInput = {
      runId: '00000000-0000-0000-0000-000000000000',
      project: {
        id: '00000000-0000-0000-0000-000000000001',
        name: '蛋白 X 机制研究',
        objective: '验证蛋白 X 是否影响肿瘤细胞增殖。',
        description: '第一轮细胞实验刚刚完成。',
        successCriteria: ['完成第一轮实验', '完成数据分析'],
        constraints: { deadline: '2027-06-30' },
        status: 'active',
        currentStage: '实验执行',
      },
      state: {
        currentStage: '实验执行',
        currentSituation: '第一轮实验正在进行。',
        openIssues: ['第一轮实验结果尚未拿到'],
        activeActions: [],
        risks: [],
        unknowns: [],
        context: {},
        version: 1,
      },
      observations: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          type: 'user_input',
          content: '第一轮实验已经完成,结果基本符合预期。',
          source: 'chat',
          createdAt: new Date().toISOString(),
          metadata: {},
        },
      ],
      events: [],
      activeActions: [],
      recentResults: [],
      memories: [],
      trigger: { type: 'observation', id: '00000000-0000-0000-0000-000000000002' },
    }

    const engine = createEngine('pi')
    const raw = await engine.run(input)
    const { output } = parseAgentOutput(raw)

    assert.ok(
      output.judgment || output.events?.length || output.actions?.length,
      '真实 Engine 至少要给出判断、事件或行动中的一项',
    )
    console.log('Engine 输出:', JSON.stringify(output, null, 2))
  },
)

const conversation: ConversationInput = {
  project: { name: '流式测试项目', objective: '验证流式对话。' },
  state: { openIssues: [] },
  history: [],
  question: '这次实验说明了什么?',
}

/** 起一个只服务这次测试的假上游,用来验证流式解析,不依赖真实 Agent 服务 */
async function withUpstream(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function engineFor(baseUrl: string): PIAgentEngine {
  return new PIAgentEngine({
    baseUrl,
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs: 5_000,
    maxRetries: 0,
  })
}

test('对话流式:上游的 SSE 分片被拼成完整回复,推理过程单独标出来', async () => {
  await withUpstream(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"reasoning_content":"先看状态,"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"reasoning_content":"再回答。"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n')
      // 故意在事件中间断开,验证跨分片的拼装
      response.write('data: {"choices":[{"delta":{"content":"第')
      response.write('二段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第三段"}}]}\n')
      response.write('\n')
      response.write('data: [DONE]\n\n')
      response.end()
    },
    async (baseUrl) => {
      const chunks: Array<{ text: string; kind: string }> = []
      const reply = await engineFor(baseUrl).converse(conversation, {
        onDelta: (text, kind) => chunks.push({ text, kind }),
      })
      assert.equal(reply, '第一段第二段第三段')
      assert.deepEqual(chunks, [
        { text: '先看状态,', kind: 'reasoning' },
        { text: '再回答。', kind: 'reasoning' },
        { text: '第一段', kind: 'content' },
        { text: '第二段', kind: 'content' },
        { text: '第三段', kind: 'content' },
      ])
    },
  )
})

test('对话流式:上游只给推理、没有正文时,推理当回复返回', async () => {
  await withUpstream(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"reasoning_content":"只能说这么多"}}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    },
    async (baseUrl) => {
      const chunks: Array<{ text: string; kind: string }> = []
      const reply = await engineFor(baseUrl).converse(conversation, {
        onDelta: (text, kind) => chunks.push({ text, kind }),
      })
      assert.equal(reply, '只能说这么多')
      assert.deepEqual(chunks, [{ text: '只能说这么多', kind: 'reasoning' }])
    },
  )
})

test('对话流式:上游忽略 stream、直接返回完整 JSON 时当作一个增量', async () => {
  await withUpstream(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: '不支持流式的回复' } }] }))
    },
    async (baseUrl) => {
      const chunks: Array<{ text: string; kind: string }> = []
      const reply = await engineFor(baseUrl).converse(conversation, {
        onDelta: (text, kind) => chunks.push({ text, kind }),
      })
      assert.equal(reply, '不支持流式的回复')
      assert.deepEqual(chunks, [{ text: '不支持流式的回复', kind: 'content' }])
    },
  )
})

test('对话流式:上游明确拒绝 stream 时退回非流式调用', async () => {
  let calls = 0
  await withUpstream(
    (request, response) => {
      calls += 1
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        if (body.includes('"stream":true')) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'unsupported parameter: stream' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '退回之后的完整回复' } }] }))
      })
    },
    async (baseUrl) => {
      const chunks: Array<{ text: string; kind: string }> = []
      const reply = await engineFor(baseUrl).converse(conversation, {
        onDelta: (text, kind) => chunks.push({ text, kind }),
      })
      assert.equal(reply, '退回之后的完整回复')
      assert.deepEqual(chunks, [{ text: '退回之后的完整回复', kind: 'content' }])
      assert.equal(calls, 2)
    },
  )
})

test('parseOrganizeOutput 接受 snake_case 与 camelCase 的整理结果', () => {
  const output = parseOrganizeOutput({
    summary: '资料核心结论',
    key_points: ['要点一', '要点二'],
    content: '整理后的正文',
  })
  assert.deepEqual(output, {
    summary: '资料核心结论',
    keyPoints: ['要点一', '要点二'],
    content: '整理后的正文',
  })

  const camel = parseOrganizeOutput({
    summary: 'S',
    keyPoints: ['a'],
    content: 'c',
  })
  assert.deepEqual(camel.keyPoints, ['a'])
})

test('parseOrganizeOutput 容忍字符串输入、单条要点和缺失正文', () => {
  const output = parseOrganizeOutput('{"summary":"结论","key_points":"单条要点"}')
  assert.equal(output.summary, '结论')
  assert.deepEqual(output.keyPoints, ['单条要点'])
  assert.equal(output.content, '')
})

test('parseOrganizeOutput 缺少 summary 判为结构错误', () => {
  assert.throws(() => parseOrganizeOutput({ key_points: ['x'] }), AgentEngineError)
  assert.throws(() => parseOrganizeOutput('不是 JSON'), AgentEngineError)
})
