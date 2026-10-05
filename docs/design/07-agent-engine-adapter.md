# Agent Engine Adapter 设计

## 1. 设计目标

LOOP Runtime 需要调用 Agent Engine 完成：

```text
Observe
  ↓
Think
  ↓
产生 Agent Output
```

当前 MVP 使用 **PI Agent** 作为 Agent Engine。

但 LOOP Runtime 不应该直接依赖 PI Agent 的具体实现。

因此增加一层轻量的 Agent Engine Adapter：

```text
LOOP Runtime
      ↓
  AgentEngine
      ↓
 PIAgentEngine
      ↓
   PI Agent
```

核心目标只有两个：

1. LOOP Runtime 不依赖 PI 的具体 API 和数据结构
2. PI Agent 的输出转换成 LOOP 统一的 `AgentOutput`

---

# 2. 设计原则

## 2.1 Adapter 要薄

MVP 不建设复杂的 Agent Engine 抽象系统。

只需要：

```text
AgentEngine Interface
        ↓
PIAgentEngine
```

未来真正需要接入其他 Agent Engine 时，再增加：

```text
OpenAIAgentEngine
ClaudeAgentEngine
CustomAgentEngine
```

---

## 2.2 Runtime 不应该知道 PI

Runtime 不应该出现：

```text
if engine == "pi"
```

也不应该直接调用：

```text
PI API
PI Session
PI Tool
PI Prompt
```

Runtime 只依赖：

```text
AgentEngine
```

---

## 2.3 Engine 不负责业务状态

Agent Engine 不直接修改：

```text
Project
State
Event
Action
Memory
Recommendation
```

Engine 只负责：

```text
Input
 ↓
Think / Execute
 ↓
Output
```

最终数据由 Runtime 负责验证和持久化。

---

# 3. 整体架构

```text
                    LOOP Runtime
                         │
                         │ AgentInput
                         ↓
                  ┌──────────────┐
                  │ AgentEngine  │
                  │   Interface  │
                  └──────┬───────┘
                         │
                         ↓
                  PIAgentEngine
                         │
                         ↓
                      PI Agent
                         │
                         ↓
                    Agent Output
                         │
                         ↓
                  PIAgentEngine
                         │
                         ↓
                  LOOP AgentOutput
                         │
                         ↓
                     Runtime
                         │
              ┌──────────┼──────────┐
              ↓          ↓          ↓
            State      Action     Event
                         │
                         ↓
                    Recommendation
```

---

# 4. AgentEngine 接口

MVP 只定义一个核心方法：

```ts
interface AgentEngine {
  run(input: AgentInput): Promise<AgentOutput>
}
```

接口不暴露 PI。

Runtime 只知道：

```text
AgentInput
    ↓
AgentEngine.run()
    ↓
AgentOutput
```

---

# 5. AgentInput

`AgentInput` 是 Runtime 提供给 Agent Engine 的统一输入。

建议结构：

```ts
interface AgentInput {
  project: ProjectContext

  state: AgentStateContext

  observations: ObservationContext[]

  activeActions: ActionContext[]

  memories: MemoryContext[]

  session?: SessionContext

  trigger: TriggerContext
}
```

---

# 6. ProjectContext

```ts
interface ProjectContext {
  id: string

  name: string

  objective: string

  description?: string

  successCriteria: unknown

  currentStage?: string
}
```

Project 是 Agent 的业务身份。

Engine 需要知道：

> 这个 Agent 是为了什么目标而运行。

---

# 7. AgentStateContext

```ts
interface AgentStateContext {
  currentStage?: string

  currentSituation?: string

  openIssues: unknown[]

  activeActions: unknown[]

  risks: unknown[]

  unknowns: unknown[]

  context: Record<string, unknown>

  version: number
}
```

State 表示：

> Agent 当前认为 Project 处于什么状态。

---

# 8. ObservationContext

```ts
interface ObservationContext {
  id: string

  type: string

  content: string

  source?: string

  createdAt: string

  metadata?: Record<string, unknown>
}
```

Observation 是 Agent 的输入信息。

例如：

```text
用户说：
第一轮实验已经完成。
```

或者：

```text
Action Result：
实验数据分析完成。
```

都可以进入 Observation。

---

# 9. ActionContext

```ts
interface ActionContext {
  id: string

  title: string

  description?: string

  executorType: string

  assigneeId?: string

  status: string

  priority: string

  dueAt?: string
}
```

Engine 需要知道当前有哪些正在执行的 Action。

否则 Agent 无法判断：

> 哪些事情已经有人在做？

---

# 10. MemoryContext

MVP 可以保持简单。

```ts
interface MemoryContext {
  id: string

  type: string

  content: string

  confidence?: number

  createdAt: string
}
```

第一版 Memory 可以不做复杂检索。

Runtime 可以只提供：

```text
相关长期记忆
```

而不是全部 Memory。

---

# 11. TriggerContext

Agent 必须知道：

> 为什么这一次被唤醒？

```ts
interface TriggerContext {
  type: string

  id?: string

  source?: string

  payload?: Record<string, unknown>
}
```

例如：

```text
type = observation
```

表示：

> 有新的 Observation。

或者：

```text
type = schedule
```

表示：

> 定时任务触发 Agent。

---

# 12. AgentOutput

这是整个 Adapter 最重要的接口。

建议：

```ts
interface AgentOutput {
  judgment?: string

  stateProposal?: StateProposal

  events?: EventProposal[]

  actions?: ActionProposal[]

  recommendations?: RecommendationProposal[]

  memories?: MemoryProposal[]
}
```

Agent 不直接修改数据库。

它只提出：

> **我认为 Project 应该发生什么变化。**

---

# 13. Judgment

Judgment 是 Agent 对当前情况的判断。

例如：

```json
{
  "judgment": "第一轮实验已经完成，结果基本符合预期。目前最重要的是分析实验数据，再决定是否进入下一轮实验。"
}
```

Judgment 主要用于：

* Agent 回复
* Recommendation
* UI 展示
* Runtime 日志

不应该作为数据库核心状态直接使用。

---

# 14. StateProposal

Agent 可以提出 State 修改：

```ts
interface StateProposal {
  currentStage?: string

  currentSituation?: string

  openIssues?: unknown[]

  activeActions?: unknown[]

  risks?: unknown[]

  unknowns?: unknown[]

  context?: Record<string, unknown>
}
```

例如：

```json
{
  "currentStage": "实验分析",
  "currentSituation": "第一轮实验已经完成，正在分析实验数据",
  "openIssues": [
    "是否进入第二轮实验"
  ]
}
```

Runtime 收到后：

```text
State Proposal
      ↓
Validation
      ↓
Version Check
      ↓
Persist
```

---

# 15. EventProposal

```ts
interface EventProposal {
  type: string

  title: string

  content: string

  occurredAt?: string
}
```

例如：

```json
{
  "type": "experiment_completed",
  "title": "第一轮实验完成",
  "content": "第一轮实验已经完成，结果基本符合预期。"
}
```

Runtime 负责最终创建 Event。

---

# 16. ActionProposal

```ts
interface ActionProposal {
  title: string

  description?: string

  executorType: "human" | "agent" | "system"

  assigneeId?: string

  priority?: "low" | "medium" | "high" | "critical"

  dueAt?: string

  eventId?: string
}
```

例如：

```json
{
  "title": "分析第一轮实验数据",
  "description": "根据第一轮实验结果进行数据分析",
  "executorType": "human",
  "priority": "high"
}
```

Runtime 决定：

```text
直接创建
```

还是：

```text
需要用户确认
```

---

# 17. RecommendationProposal

```ts
interface RecommendationProposal {
  type: string

  content: string

  priority: "low" | "medium" | "high" | "critical"

  requiresConfirmation: boolean
}
```

例如：

```json
{
  "type": "next_step",
  "content": "建议先完成第一轮实验数据分析，再决定是否进入第二轮实验。",
  "priority": "high",
  "requiresConfirmation": true
}
```

---

# 18. MemoryProposal

第一版可以支持：

```ts
interface MemoryProposal {
  type: "event" | "decision" | "action" | "conclusion" | "context"

  content: string

  confidence?: number
}
```

例如：

```json
{
  "type": "decision",
  "content": "项目决定先完成第一轮实验数据分析，再决定是否进入第二轮实验。"
}
```

Runtime 可以根据策略：

```text
直接保存
```

或者：

```text
需要确认
```

---

# 19. PI Adapter

PI Adapter 的职责非常简单：

```text
AgentInput
    ↓
转换为 PI 输入
    ↓
调用 PI
    ↓
获取 PI 输出
    ↓
转换为 AgentOutput
```

伪代码：

```ts
class PIAgentEngine implements AgentEngine {

  async run(input: AgentInput): Promise<AgentOutput> {

    const piInput = this.buildPIInput(input)

    const result = await this.pi.run(piInput)

    return this.parsePIOutput(result)
  }
}
```

---

# 20. buildPIInput

PI Adapter 负责把 LOOP Context 转换成 PI 能理解的输入。

```ts
private buildPIInput(
  input: AgentInput
): PIInput {

  return {
    objective: input.project.objective,

    state: input.state,

    observations: input.observations,

    activeActions: input.activeActions,

    memories: input.memories,

    trigger: input.trigger
  }
}
```

具体 Prompt、System Instruction、PI Session 等内容属于 Adapter 内部实现。

Runtime 不应该关心。

---

# 21. parsePIOutput

PI 返回结果后，由 Adapter 转换成统一结构。

```ts
private parsePIOutput(
  result: PIResult
): AgentOutput {

  return {
    judgment: result.judgment,

    stateProposal: result.state,

    events: result.events,

    actions: result.actions,

    recommendations: result.recommendations,

    memories: result.memories
  }
}
```

如果 PI 的输出格式发生变化：

```text
PI Output
```

只需要修改：

```text
PIAgentEngine
```

而不是修改整个 Runtime。

---

# 22. Tool Calling

如果 PI Agent 支持 Tool Calling：

```text
PI Agent
    ↓
Tool Call
    ↓
LOOP Tool Registry
    ↓
Tool Executor
    ↓
Tool Result
    ↓
PI Agent
```

这里需要明确：

> **Tool 是 Agent 的执行能力，Adapter 负责协议转换，Runtime 负责实际执行和权限控制。**

例如 Agent 请求：

```json
{
  "tool": "create_action",
  "input": {
    "title": "分析实验数据"
  }
}
```

Adapter 不应该直接操作数据库。

应该：

```text
PI
 ↓
Tool Call
 ↓
Runtime Tool Executor
 ↓
Validation
 ↓
Database
```

---

# 23. Tool Registry

MVP 可以定义简单的 Tool Registry：

```ts
interface Tool {
  name: string

  description: string

  execute(
    input: unknown,
    context: ToolContext
  ): Promise<unknown>
}
```

例如：

```text
create_action
complete_action
get_project_state
search_memory
```

不过 MVP 不需要一次实现大量 Tool。

优先实现：

```text
get_project_state
create_action
complete_action
```

---

# 24. Agent Engine 与 Tool 的边界

需要严格区分：

### Agent Engine

负责：

```text
理解
判断
规划
选择 Tool
产生 Output
```

### Runtime

负责：

```text
权限
Tool 执行
数据库
状态更新
事务
幂等
并发
```

因此：

```text
PI Agent
    ↓
“我要创建一个 Action”
    ↓
Tool Call
    ↓
Runtime
    ↓
验证
    ↓
创建 Action
```

而不是：

```text
PI Agent
    ↓
直接写数据库
```

---

# 25. Error Handling

Adapter 需要统一处理 Engine 层错误。

例如：

```ts
class AgentEngineError extends Error {
  code: string
  retryable: boolean
}
```

常见错误：

```text
ENGINE_UNAVAILABLE
ENGINE_TIMEOUT
ENGINE_AUTH_ERROR
ENGINE_INVALID_OUTPUT
ENGINE_RATE_LIMITED
ENGINE_EXECUTION_ERROR
```

Runtime 根据 `retryable` 判断是否重试。

---

# 26. Timeout

Agent Engine 必须有执行超时。

例如：

```text
Agent Run
   ↓
PI Agent
   ↓
Timeout
```

Runtime：

```text
Agent Run = failed
```

并记录：

```json
{
  "code": "ENGINE_TIMEOUT"
}
```

如果任务可以安全重试，则重新进入 Queue。

---

# 27. Retry

不要无限重试。

MVP 建议：

```text
第一次失败
 ↓
等待
 ↓
Retry #1
 ↓
失败
 ↓
Retry #2
 ↓
失败
 ↓
Agent Run = failed
```

具体次数和退避策略可以通过 Runtime 配置。

---

# 28. Engine Session

需要区分：

```text
LOOP Session
```

和：

```text
PI Session
```

LOOP Session 是业务层概念：

```text
chat
meeting
schedule
event
api
system
```

PI Session 是 Engine 内部实现。

因此：

```text
LOOP Session
      ↓
Agent Run
      ↓
PI Session
```

不能让业务代码依赖 PI Session。

如果未来换 Engine：

```text
LOOP Session
      ↓
Agent Run
      ↓
OpenAI Session
```

业务层无需改变。

---

# 29. Context Builder 与 Adapter 的边界

这两个模块必须分开。

### Context Builder

负责：

> LOOP 应该把什么信息交给 Agent？

例如：

```text
Project
State
Recent Observation
Active Action
Memory
```

### Adapter

负责：

> 如何把这些信息交给具体 Agent Engine？

因此：

```text
Database
   ↓
Context Builder
   ↓
AgentInput
   ↓
PI Adapter
   ↓
PI
```

不要让 PI Adapter 自己查询数据库。

---

# 30. Runtime 完整调用链

```text
Trigger
   ↓
Agent Run
   ↓
Load Project
   ↓
Load State
   ↓
Load Observation
   ↓
Load Active Actions
   ↓
Load Memory
   ↓
Context Builder
   ↓
AgentInput
   ↓
AgentEngine
   ↓
PIAgentEngine
   ↓
PI Agent
   ↓
AgentOutput
   ↓
Output Validator
   ↓
State / Event / Action /
Recommendation / Memory
   ↓
Persistence
   ↓
Agent Run Completed
```

---

# 31. 推荐代码结构

MVP 建议：

```text
src/
├── agent/
│   ├── engine.ts
│   ├── types.ts
│   ├── context-builder.ts
│   ├── output-validator.ts
│   │
│   └── pi/
│       ├── pi-engine.ts
│       ├── pi-client.ts
│       ├── pi-input.ts
│       └── pi-output.ts
│
├── runtime/
│   ├── agent-runner.ts
│   ├── trigger-handler.ts
│   └── loop.ts
│
├── tools/
│   ├── registry.ts
│   ├── project-tools.ts
│   └── action-tools.ts
│
└── modules/
    ├── projects/
    ├── states/
    ├── observations/
    ├── actions/
    └── recommendations/
```

---

# 32. MVP 不需要做的 Adapter 能力

第一版明确不要做：

```text
多 Engine 动态路由
Engine Marketplace
Engine 自动选择
复杂 Prompt Management
Engine Performance Dashboard
Engine A/B Test
多模型自动 fallback
复杂模型配置中心
```

这些都不是 LOOP 核心能力。

---

# 33. MVP 验收标准

PI
