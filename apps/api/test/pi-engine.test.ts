import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEngine } from '../src/agent/engine-factory.js'
import { AgentEngineError } from '../src/agent/engine.js'
import { parseAgentOutput, parseOrganizeOutput } from '../src/agent/output-validator.js'
import { config } from '../src/config.js'
import type { AgentInput } from '../src/agent/types.js'

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
