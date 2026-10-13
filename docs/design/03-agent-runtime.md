# Agent Runtime 技术设计

## 1. 文档目的

本文定义 LOOP Agent Runtime 的技术架构和运行机制，用于指导后端开发。

LOOP 的核心不是让 AI 聊天，而是：

> **让一个 Project 持续作为一个 Agent 运行。**

Agent 需要能够：

```text
Observe
  ↓
Think
  ↓
Recommend / Act
  ↓
Execute
  ↓
Result
  ↓
Update State
  ↓
Wait
  ↓
Observe
  ↓
...
```

Runtime 负责保证这个循环能够长期、可靠地运行。

---

# 2. 核心设计原则

## 2.1 Project = Agent

MVP 不创建独立 `agents` 表。

```text
Project
   ↓
Agent
```

Project 的：

* `id`：Agent 身份
* `objective`：Agent 存在的目的
* `success_criteria`：完成条件
* `status`：Agent 生命周期
* `agent_states`：当前状态
* `memories`：长期记忆
* `actions`：当前行动
* `observations`：现实输入

因此：

> **Project 是 Agent 的业务实体，Runtime 是 Agent 的运行环境。**

---

# 3. Runtime 的职责

Runtime 负责：

1. 接收 Trigger
2. 创建 Agent Run
3. 获取 Project 当前状态
4. 获取相关 Observation
5. 获取相关 Memory
6. 构建 Agent Context
7. 调用 Agent Engine
8. 解析 Agent 输出
9. 创建 Recommendation / Action / Event
10. 更新 State
11. 执行允许自动执行的 Action
12. 保存 Execution Result
13. 产生新的 Observation
14. 再次触发 Agent
15. 处理失败、重试和恢复
16. 执行 Schedule
17. 控制 Agent 生命周期
18. 保证 Project 隔离和并发安全

Runtime 不负责具体业务领域逻辑。

---

# 4. Runtime 总体架构

```text
                    LOOP API
                       │
                       ↓
              ┌─────────────────┐
              │  Trigger Layer  │
              └────────┬────────┘
                       ↓
              ┌─────────────────┐
              │   Agent Run     │
              │   Orchestrator  │
              └────────┬────────┘
                       ↓
              ┌─────────────────┐
              │ Context Builder │
              └────────┬────────┘
                       ↓
              ┌─────────────────┐
              │  Agent Engine   │
              │     Adapter     │
              └────────┬────────┘
                       ↓
                  PI Agent
                       │
                       ↓
              Structured Output
                       │
                       ↓
              ┌─────────────────┐
              │ Output Processor│
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
        State       Action      Recommendation
          │            │            │
          └────────────┼────────────┘
                       ↓
                  Persistence
                       ↓
                  Execution
                       ↓
                    Result
                       ↓
                 Observation
                       ↓
                    Trigger
```

Runtime 本身不等于 PI Agent。

关系为：

```text
LOOP Runtime
      │
      ↓
Agent Engine Adapter
      │
      ↓
PI Agent
```

未来可以替换：

```text
PI Agent
OpenAI Agent
Claude Agent
Custom Agent
...
```

业务层不应该依赖具体 Engine。

---

# 5. Agent Run

## 5.1 定义

`Agent Run` 是 Agent 一次完整的运行过程。

例如：

```text
用户发送消息
        ↓
创建 Observation
        ↓
Agent Run #1001
        ↓
读取 State
        ↓
Think
        ↓
产生 Action
        ↓
结束
```

如果 Action 自动执行：

```text
Agent Run
   ↓
Action
   ↓
Execution
   ↓
Result
   ↓
Observation
   ↓
Agent Run #1002
```

因此：

> **Agent Run 是一次运行，不是 Agent 本身。**

---

# 6. Agent Run 状态机

建议状态：

```text
pending
   ↓
running
   ↓
completed
```

异常：

```text
running
   ↓
failed
   ↓
retry
   ↓
running
```

取消：

```text
pending / running
       ↓
   cancelled
```

完整状态：

```text
          ┌──────────────┐
          │    pending   │
          └──────┬───────┘
                 ↓
          ┌──────────────┐
          │    running   │
          └───┬──────┬───┘
              │      │
              ↓      ↓
        completed   failed
                       │
                       ↓
                     retry
                       │
                       └──→ running

pending/running
       │
       ↓
 cancelled
```

---

# 7. Trigger

Agent 不应该一直占用 LLM 运行。

Agent 平时处于：

```text
Waiting
```

当发生 Trigger 时才唤醒。

Trigger 来源：

```text
User
Observation
Schedule
Event
API
System
```

例如：

### 用户输入

```text
User
 ↓
Observation
 ↓
Trigger
 ↓
Agent Run
```

### Action 执行完成

```text
Action
 ↓
Execution
 ↓
Result
 ↓
Observation
 ↓
Trigger
 ↓
Agent Run
```

### 定时任务

```text
Schedule
 ↓
Trigger
 ↓
Agent Run
```

### 外部系统

```text
External API
 ↓
Observation
 ↓
Trigger
 ↓
Agent Run
```

---

# 8. Trigger 不直接调用 Agent

不要设计成：

```text
HTTP Request
   ↓
直接调用 PI
```

应该：

```text
HTTP Request
   ↓
Create Observation
   ↓
Create Agent Run
   ↓
Queue
   ↓
Worker
   ↓
Agent Runtime
```

这样可以解决：

* 请求超时
* LLM 调用时间过长
* 重试
* 并发
* 定时任务
* 崩溃恢复
* 多项目同时运行

---

# 9. Queue / Worker

Runtime 建议采用：

```text
Trigger
   ↓
Queue
   ↓
Worker
   ↓
Agent Run
```

Worker 从 Queue 中获取待运行的 Agent Run。

例如：

```text
Queue

Project A → Run 1001
Project B → Run 1002
Project C → Run 1003
```

Worker：

```text
Worker 1 → Project A
Worker 2 → Project B
Worker 3 → Project C
```

---

# 10. Project 级并发控制

这是 Runtime 最重要的机制之一。

同一个 Project 不应该同时存在两个修改 State 的 Agent Run。

例如：

```text
Project A

Run 1001 → running
Run 1002 → pending
Run 1003 → pending
```

而不是：

```text
Run 1001 → 修改 State
Run 1002 → 同时修改 State
Run 1003 → 同时修改 State
```

否则可能出现：

```text
State v10
 ↓
Run A → State v11
Run B → State v11
```

导致状态覆盖。

因此 MVP 建议：

> **同一个 Project 同一时间只允许一个有效 Agent Run 修改状态。**

其他 Trigger：

```text
pending
```

等待当前 Run 完成。

---

# 11. Observation

Observation 是 Agent 的输入事实。

它表示：

> **刚刚发生了什么。**

例如：

```text
用户输入
会议结束
实验完成
Action 执行完成
外部 API 发生变化
定时检查
文档上传
```

Observation 不等于 Memory。

例如：

```text
Observation:
实验 B 今天完成了。
```

不代表一定产生长期 Memory。

Agent 判断后可能产生：

```text
Event:
实验 B 完成

State:
当前阶段进入数据分析

Action:
分析实验 B 数据
```

---

# 12. Observation Processing

收到 Observation 后：

```text
Observation
      ↓
Create Agent Run
      ↓
Load Project
      ↓
Load State
      ↓
Load Recent Context
      ↓
Think
```

MVP 不要求每个 Observation 都建立复杂 Memory。

优先使用：

```text
Project
+
Current State
+
Recent Observations
+
Active Actions
+
Recent Results
```

长期 Memory 后续再加入。

这与当前 MVP 设计保持一致：第一版不应该为了“Agent”而提前建立复杂 Memory 系统。

---

# 13. Context Builder

Context Builder 负责将数据库中的信息转换成 Agent 能够理解的 Context。

输入：

```text
Project
State
Observation
Recent Events
Active Actions
Recent Results
Memory
```

输出：

```text
Agent Context
```

建议结构：

```json
{
  "project": {
    "name": "...",
    "objective": "...",
    "success_criteria": [],
    "constraints": []
  },

  "state": {
    "current_stage": "...",
    "current_situation": "...",
    "open_issues": [],
    "active_actions": [],
    "risks": [],
    "unknowns": []
  },

  "trigger": {
    "type": "observation",
    "content": "..."
  },

  "recent_events": [],

  "active_actions": [],

  "recent_results": [],

  "memories": []
}
```

---

# 14. Context 构建原则

Context 不应该把整个数据库全部塞给 LLM。

应该：

```text
全部数据
   ↓
Context Builder
   ↓
筛选
   ↓
排序
   ↓
压缩
   ↓
Relevant Context
```

优先级：

```text
1. 当前 Observation
2. Current State
3. Active Actions
4. 最近 Events
5. 最近 Execution Results
6. Relevant Memory
7. 更早历史
```

原则：

> **当前状态优先于历史。**

---

# 15. Memory Retrieval

Memory 是长期信息。

例如：

```text
Decision:
决定优先采用方案 A

Conclusion:
方案 B 已经连续两次失败

Context:
用户希望所有实验都保留原始数据
```

MVP 可以先使用：

```text
Project
+
State
+
Recent Events
+
Active Actions
```

作为主要 Context。

Memory Retrieval 可以设计成独立接口：

```text
MemoryService.retrieve(
    project_id,
    query,
    limit
)
```

未来再加入：

* embedding
* vector search
* semantic retrieval
* memory ranking
* memory consolidation

Runtime 不应该绑定具体 Memory 实现。

---

# 16. Agent Engine Adapter

Runtime 不直接调用 PI。

定义统一接口：

```text
AgentEngine
    └── run(context)
```

PI：

```text
PIAgentAdapter
    └── run(context)
```

未来：

```text
OpenAIAdapter
ClaudeAdapter
CustomAdapter
```

都实现相同接口。

---

# 17. Agent Engine 输入

Engine 输入至少包括：

```text
Project Objective
Success Criteria
Current State
Current Observation
Active Actions
Relevant Events
Relevant Memory
Available Tools
Agent Rules
```

例如：

```text
你是一个长期运行的 Project Agent。

你的目标：
验证 X 是否具有抗肿瘤作用。

当前状态：
...

当前发生：
实验 B 已完成。

当前行动：
...

请判断：
1. 当前发生了什么
2. 对项目状态有什么影响
3. 是否产生新的 Event
4. 是否需要新的 Action
5. 是否存在风险
6. 是否需要人工确认
```

---

# 18. 不允许依赖隐藏 Chain of Thought

Runtime 不需要保存 LLM 的完整思维链。

Agent 输出应该是：

```text
Judgment
Recommendation
State Changes
Events
Actions
Risk
```

而不是：

```text
完整内部推理过程
```

UI 可以展示：

> 当前判断

> 为什么需要处理

> 建议下一步

但不需要展示模型内部完整推理。

---

# 19. Agent Output Protocol

这是 Runtime 和 Agent Engine 之间最重要的协议。

建议 Agent 返回结构化 JSON。

```json
{
  "judgment": {
    "content": "实验 B 已完成，但目前还无法判断结果是否支持当前假设"
  },

  "events": [
    {
      "title": "实验 B 完成",
      "content": "实验 B 已完成",
      "type": "experiment_completed"
    }
  ],

  "actions": [
    {
      "title": "分析实验 B 数据",
      "description": "对实验 B 数据进行统计分析",
      "executor_type": "human",
      "priority": "high"
    }
  ],

  "recommendations": [
    {
      "type": "next_step",
      "content": "建议先完成实验 B 数据分析",
      "requires_confirmation": true
    }
  ],

  "state_patch": {
    "current_stage": "数据分析",
    "current_situation": "实验 B 已完成，等待数据分析"
  },

  "memories": []
}
```

---

# 20. Output Processor

Runtime 收到 Agent Output 后，不应该直接写数据库。

必须经过：

```text
Agent Output
      ↓
Schema Validation
      ↓
Business Validation
      ↓
Permission Validation
      ↓
Conflict Detection
      ↓
Human Confirmation / Auto Apply
      ↓
Persistence
```

这样可以防止：

* LLM 输出非法数据
* 修改不存在的 Action
* 修改其他 Project
* 越权执行
* State 被错误覆盖

---

# 21. State 更新

Agent 可以提出：

```text
state_patch
```

例如：

```json
{
  "current_stage": "实验验证",
  "current_situation": "实验 B 已完成",
  "open_issues": [
    "实验 B 数据尚未分析"
  ]
}
```

Runtime 不直接覆盖 State。

流程：

```text
Current State v10
       ↓
Agent Proposal
       ↓
Validate
       ↓
Version Check
       ↓
Apply
       ↓
State v11
```

---

# 22. State Optimistic Lock

`agent_states.version` 用于防止并发覆盖。

例如：

```text
Current State = v10
```

Run A：

```text
读取 v10
```

Run B：

```text
读取 v10
```

A 更新：

```text
v10 → v11
```

B 更新时发现：

```text
expected_version = 10
actual_version = 11
```

于是：

```text
Conflict
```

B 不应该直接覆盖。

应该：

```text
重新读取 State
      ↓
重新构建 Context
      ↓
重新 Think
```

---

# 23. Action 处理

Agent 可以产生：

```text
Action
```

Action 表示：

> **下一步需要做什么。**

例如：

```text
Action:
分析实验 B 数据
```

Action 不等于 Execution。

关系：

```text
Action
   │
   ├── Execution 1
   ├── Execution 2
   └── Execution 3
```

例如：

```text
Action:
调用外部 API 获取数据

Execution 1:
失败

Execution 2:
成功
```

因此：

> Action 是意图，Execution 是一次实际执行。

---

# 24. Action Executor

Action 创建后，根据：

```text
executor_type
```

决定如何执行。

```text
human
agent
system
```

### human

```text
Action
 ↓
等待用户
 ↓
用户执行
 ↓
Result
```

### agent

```text
Action
 ↓
Agent Executor
 ↓
Execution
 ↓
Result
```

### system

```text
Action
 ↓
System Tool
 ↓
Execution
 ↓
Result
```

---

# 25. Human Confirmation

不是所有 Agent 输出都应该自动执行。

建议三个等级。

### Level 1：自动

例如：

* 更新项目摘要
* 生成状态分析
* 整理信息
* 检查 Action 是否完成

### Level 2：建议确认

例如：

* 创建 Action
* 修改阶段
* 调整执行路线

### Level 3：必须确认

例如：

* 修改项目核心目标
* 完成项目
* 终止项目
* 对外发布
* 重大资源投入

Runtime 根据 Action / Recommendation 的权限规则决定：

```text
Auto Apply
```

还是：

```text
Pending Confirmation
```

---

# 26. Recommendation

Recommendation 是 Agent 对用户提出的建议。

例如：

```text
Recommendation

当前实验结果与此前结论存在冲突。

建议：
重新检查实验条件。

[接受]
[忽略]
```

状态：

```text
pending
accepted
rejected
expired
executed
```

Recommendation 被接受后，可以产生：

```text
Action
```

---

# 27. Action Execution Loop

一个完整的 Agent Loop：

```text
Observation
     ↓
Agent Run
     ↓
Context
     ↓
Think
     ↓
Output
     ↓
Action
     ↓
Execution
     ↓
Result
     ↓
Observation
     ↓
New Agent Run
```

例如：

```text
用户：
“实验 B 已经完成。”

        ↓

Observation

        ↓

Agent Run

        ↓

Agent 判断：
实验 B 已完成

        ↓

Event：
实验 B 完成

        ↓

Action：
分析实验 B 数据

        ↓

用户确认

        ↓

用户完成数据分析

        ↓

Observation：
数据分析完成

        ↓

Agent Run

        ↓

Agent 判断：
实验 B 数据支持当前假设

        ↓

更新 State
```

这才是 LOOP 的核心运行机制。

---

# 28. Event 与 Action 的自动关联

Runtime 应支持 Event 与 Action 的关联。

例如：

```text
Action:
完成实验 B
```

之后出现：

```text
Event:
实验 B 已完成
```

Agent 判断二者对应：

```text
Event
  ↓
Match
  ↓
Action
  ↓
completed
```

用户不需要手动：

```text
勾选任务完成
```

系统通过现实发生的 Event 更新 Action 状态。

---

# 29. Event 不是 Action 的附属物

Event 是事实层。

```text
Event = Fact
Action = Intention
```

例如：

```text
Action:
重新实验 B

↓

Event:
实验 B 再次失败

↓

Action:
分析失败原因

↓

Event:
发现实验条件异常

↓

Action:
调整实验条件
```

因此 Runtime 应围绕：

```text
Event → Action → Event
```

不断驱动 Agent。

---

# 30. Tool Calling

如果 PI Agent 需要调用工具：

```text
Agent
 ↓
Tool Call
 ↓
Tool Executor
 ↓
Result
 ↓
Agent
```

例如：

```text
Agent
 ↓
搜索项目文档
 ↓
Document Search
 ↓
返回结果
 ↓
Agent继续判断
```

数据库中的 `tool_calls` 用于记录：

```text
agent_run_id
tool_name
input
output
status
error
started_at
completed_at
```

Runtime 负责 Tool 的生命周期。

PI 不应该直接管理 LOOP 数据库。

---

# 31. Agent Run 与 Tool Call 的关系

```text
Agent Run
 ├── Tool Call 1
 ├── Tool Call 2
 └── Tool Call 3
```

一个 Agent Run 可以调用多个 Tool。

例如：

```text
Run #1001

1. search_project_events
2. search_memories
3. analyze_data
4. create_recommendation
```

---

# 32. Failure Handling

Runtime 必须区分不同失败。

### LLM Failure

```text
PI Timeout
PI Error
Rate Limit
Invalid Response
```

处理：

```text
Retry
```

### Tool Failure

```text
Tool Timeout
Tool Error
External API Error
```

处理：

```text
Execution → failed
```

然后：

```text
Observation:
Action 执行失败
```

重新进入 Agent Loop。

### State Conflict

```text
Optimistic Lock Conflict
```

处理：

```text
Reload State
   ↓
Rebuild Context
   ↓
Retry Agent Run
```

### Invalid Agent Output

```text
JSON Schema Invalid
```

处理：

```text
Retry / Repair
```

不能直接写数据库。

---

# 33. Retry

建议不同错误使用不同 Retry 策略。

例如：

```text
LLM Timeout
→ retry 3 times

Rate Limit
→ exponential backoff

Invalid JSON
→ repair / retry

Business Validation Error
→ do not retry automatically
```

避免：

```text
所有错误无限重试
```

---

# 34. Idempotency

Runtime 中必须支持幂等。

例如用户重复提交：

```text
POST /observations
```

不能导致：

```text
Observation A
Observation A
Observation A
```

因此请求需要：

```text
idempotency_key
```

Action Execution 同样需要：

```text
idempotency_key
```

例如：

```text
project_id + action_id + execution_key
```

保证同一次执行不会重复执行。

---

# 35. Schedule

Schedule 的作用：

> **唤醒 Agent。**

Schedule 不负责思考。

例如：

```text
每天 09:00
     ↓
Schedule Trigger
     ↓
Observation:
“定时检查项目状态”
     ↓
Agent Run
```

Agent 再决定：

```text
项目是否需要关注？
是否存在风险？
是否需要提醒？
是否产生 Recommendation？
```

因此：

> Schedule 是 Trigger，不是 Agent。

---

# 36. Schedule Worker

建议独立 Scheduler：

```text
Scheduler
   ↓
查询 schedules
   ↓
发现 next_run_at <= now
   ↓
创建 Agent Run
   ↓
更新 next_run_at
   ↓
Queue
```

不要让 Scheduler 直接调用 PI。

---

# 37. Event Trigger

除了时间，还可以由事件唤醒 Agent。

例如：

```text
Action completed
       ↓
Observation
       ↓
Event Trigger
       ↓
Agent Run
```

或者：

```text
External System Changed
       ↓
Observation
       ↓
Agent Run
```

---

# 38. Continuous Agent

LOOP 并不是：

```text
while(true) {
    callLLM()
}
```

真正的运行方式是：

```text
             ┌───────────────┐
             │    Waiting    │
             └───────┬───────┘
                     │
                  Trigger
                     ↓
             ┌───────────────┐
             │   Agent Run   │
             └───────┬───────┘
                     ↓
                  Think
                     ↓
              Action / Result
                     ↓
                Observation
                     ↓
             ┌───────────────┐
             │    Waiting    │
             └───────────────┘
```

因此 Agent 是：

> **事件驱动的长期运行实体。**

而不是持续占用计算资源的进程。

---

# 39. Agent 生命周期

Project：

```text
created
   ↓
active
   ↓
paused
   ↓
active
   ↓
completed
   ↓
archived
```

### Created

初始化：

```text
Project
State
```

### Active

允许：

```text
Observation
Think
Action
Schedule
```

### Paused

暂停 Agent 自动运行：

```text
不执行 Schedule
不主动执行 Action
```

但仍然可以：

```text
接受用户输入
```

### Completed

Agent 不再产生新的必要 Action。

完成逻辑：

```text
Success Criteria satisfied
+
No Critical Open Issue
+
No Necessary Action
```

Agent 可以提出：

```text
Recommendation:
Complete Project
```

用户确认：

```text
Project → completed
```

---

# 40. Project 隔离

Project 是 Runtime 的核心隔离边界。

例如：

```text
Project A
 ├── State A
 ├── Memory A
 ├── Sessions A
 ├── Actions A
 └── Runs A

Project B
 ├── State B
 ├── Memory B
 ├── Sessions B
 ├── Actions B
 └── Runs B
```

即使：

```text
User A
```

同时加入：

```text
Project A
Project B
```

也不能共享：

```text
State
Memory
Session
Agent Run
Action
Observation
```

除非未来明确提供跨 Project Context 功能。

---

# 41. Runtime API 内部接口

建议 Runtime 内部模块接口保持简单。

## ObservationService

```text
createObservation(
    projectId,
    input
)
```

负责：

```text
创建 Observation
触发 Agent Run
```

---

## AgentRunService

```text
createRun(
    projectId,
    trigger
)
```

```text
run(
    agentRunId
)
```

负责：

```text
Agent Run 生命周期
```

---

## ContextService

```text
buildContext(
    projectId,
    agentRunId
)
```

负责：

```text
Project
State
Observation
Event
Action
Memory
```

组合。

---

## AgentEngine

```text
run(context)
```

负责调用具体 Agent Engine。

---

## OutputProcessor

```text
process(
    agentRunId,
    output
)
```

负责：

```text
Validation
State Proposal
Event
Action
Recommendation
Memory
```

---

## ActionService

```text
createAction(...)
```

```text
executeAction(...)
```

```text
completeAction(...)
```

---

## ExecutionService

```text
createExecution(...)
```

```text
runExecution(...)
```

```text
completeExecution(...)
```

---

## ScheduleService

```text
createSchedule(...)
```

```text
processSchedules()
```

```text
triggerSchedule(...)
```

---

# 42. Runtime 主流程

最终可以统一成下面这个流程：

```text
                    Trigger
                       ↓
              Create Observation
                       ↓
                 Create Run
                       ↓
                    Queue
                       ↓
                    Worker
                       ↓
               Lock Project
                       ↓
               Load Project
                       ↓
                Load State
                       ↓
            Build Agent Context
                       ↓
                Call PI Agent
                       ↓
             Validate Output
                       ↓
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       State         Event       Action
          │            │            │
          ↓            ↓            ↓
       Persist      Persist      Persist
          │            │            │
          └────────────┼────────────┘
                       ↓
                Recommendation
                       ↓
             Human / Auto Apply
                       ↓
                  Execute
                       ↓
                    Result
                       ↓
                 Observation
                       ↓
                   New Run
```

---

# 43. 一个完整实例

假设 Project：

```text
目标：
验证 X 是否具有抗肿瘤作用
```

当前 State：

```text
阶段：
动物实验

Action：
完成实验 B
```

用户输入：

> “实验 B 已经完成了，但是结果比预期差很多。”

---

### Step 1：创建 Observation

```json
{
  "type": "user_input",
  "content": "实验 B 已经完成了，但是结果比预期差很多。"
}
```

---

### Step 2：创建 Agent Run

```text
Run #1001
trigger_type = user
status = pending
```

---

### Step 3：Context Builder

读取：

```text
Project
State
Active Action
Recent Events
Recent Results
```

---

### Step 4：PI Agent

Agent 判断：

```text
Event：
实验 B 已完成

新的问题：
实验结果低于预期
```

产生：

```text
Action：
分析实验 B 结果异常原因
```

以及：

```text
Recommendation：
建议暂时不要继续下一轮实验，
先分析异常原因。
```

---

### Step 5：Runtime 持久化

```text
Event → persisted

Action → persisted

Recommendation → pending
```

---

### Step 6：用户确认

用户：

```text
接受
```

Action：

```text
pending
```

变成：

```text
执行中 / 待执行
```

---

### Step 7：执行

如果是人工执行：

```text
Action
 ↓
等待用户
```

如果是 Agent 可执行：

```text
Action
 ↓
Execution
 ↓
Tool
 ↓
Result
```

---

### Step 8：新结果

产生：

```text
Observation：
异常原因已经找到
```

再次：

```text
Observation
 ↓
Agent Run
 ↓
Think
 ↓
State Update
 ↓
Next Action
```

整个 Project 就这样持续向前推进。

---

# 44. MVP Runtime

第一版不要实现完整的 Agent 平台。

只实现：

```text
Project
   ↓
Observation
   ↓
Agent Run
   ↓
Context
   ↓
PI Agent
   ↓
Structured Output
   ↓
State
Event
Action
Recommendation
```

再增加：

```text
Action
 ↓
Execution
 ↓
Result
 ↓
Observation
```

最后增加：

```text
Schedule
 ↓
Trigger
 ↓
Agent Run
```

---

# 45. MVP 暂不实现

以下功能暂时不需要：

* 多 Agent 协作
* Agent 间通信
* 复杂 Planning
* 自动生成复杂 Workflow
* 向量数据库
* 高级 Memory Consolidation
* 多模型动态路由
* Agent Marketplace
* Agent 自我复制
* 分布式 Agent Swarm
* 复杂权限系统
* 多层级任务树

这些都不是 LOOP 第一版的核心。

---

# 46. MVP Runtime 最小闭环

最终 MVP 只需要保证：

```text
User
 ↓
Observation
 ↓
Agent Run
 ↓
Context
 ↓
PI Agent
 ↓
Structured Output
 ↓
State / Event / Action
 ↓
Human Confirmation
 ↓
Execution
 ↓
Result
 ↓
Observation
 ↓
Agent Run
```

如果这个闭环跑通：

> LOOP 就已经是一个真正的 Long-running Agent Runtime。

---

# 47. Runtime 最重要的三个原则

### 原则一：PI 不是 Agent

PI 只是：

> **Think / Tool Calling Engine**

真正的 Agent 是：

```text
Project
+
State
+
Memory
+
Observation
+
Runtime
```

---

### 原则二：Runtime 才是长期存在的部分

PI 可以：

```text
启动
 ↓
思考
 ↓
结束
```

但 LOOP Agent：

```text
今天运行
 ↓
等待
 ↓
明天运行
 ↓
等待
 ↓
下周运行
 ↓
...
```

所以：

> **PI 是一次运行，Runtime 是持续存在。**

---

### 原则三：Agent 不等于 Chat

Chat 只是 Trigger 的一种：

```text
Chat
 ↓
Observation
 ↓
Agent Run
```

除此之外还有：

```text
Schedule
Event
Action Result
API
System
```

因此：

> **Chat 是 Agent 的入口之一，而不是 Agent 本身。**

---

# 48. 最终架构

LOOP 最终可以抽象为：

```text
                    ┌────────────────────┐
                    │      Project       │
                    │      = Agent       │
                    └─────────┬──────────┘
                              │
                     ┌────────┴────────┐
                     ↓                 ↓
                   State            Memory
                     │                 │
                     └────────┬────────┘
                              ↓
                         Observation
                              ↓
                           Trigger
                              ↓
                         Agent Run
                              ↓
                       Context Builder
                              ↓
                       Agent Engine
                              ↓
                          PI Agent
                              ↓
                     Structured Output
                              ↓
                ┌─────────────┼─────────────┐
                ↓             ↓             ↓
              Event         Action      Recommendation
                │             │             │
                │             ↓             ↓
                │         Execution      Human
                │             ↓         Confirmation
                │           Result          │
                │             │             │
                └─────────────┴─────────────┘
                              ↓
                         Observation
                              ↓
                            Loop
```

最终：

> **Project 定义 Agent 是谁。**

> **State 定义 Agent 现在知道什么。**

> **Memory 定义 Agent 记得什么。**

> **Observation 告诉 Agent 世界发生了什么。**

> **PI Agent 负责 Think。**

> **Runtime 负责让 Think 产生真实的状态变化和行动，并持续运行下去。**

因此 LOOP 的核心技术并不是“怎么调用一个大模型”，而是：

> **如何让一个 Project 在数天、数周甚至数月的时间里，持续根据现实变化进行 Observe → Think → Act → Feedback。**

---

# 49. 实现说明

第 4 节到第 42 节描述的是 Runtime 的行为契约，第一版实现完全按这套契约落地。落地时有几处需要说明的细节：

## 49.1 Worker 与队列

Queue 就是 `agent_runs` 表本身：待运行任务是 `status = 'pending'` 的记录，Worker 用 `FOR UPDATE SKIP LOCKED` 认领，认领时把状态改成 `running` 并累加 `attempts`。这样不需要额外的消息队列，Worker 崩溃后任务也不会丢。

同一个 Project 的并发控制分两层：先尝试拿 `project_locks` 里的 Project 锁，拿不到就把这次 Run 退回 `pending` 等待；即使锁失效，State 的 `version` 乐观锁仍然会拦住覆盖写入，冲突后 Run 会按第 33 节的策略重试。

## 49.2 一次 Run 的写入边界

`Output Processor` 在一个事务里完成 Event、Action、Recommendation、Memory 的写入和 State 更新。事务之后 Runtime 还会同步一次 `state.active_actions`，让 State 里的行动摘要始终和 `actions` 表里未结束的记录一致。因此一次 Run 通常会产生两个 State 版本：一个是 Agent 提出的 State Proposal，一个是 Runtime 同步的行动摘要。

Action 完成、失败、取消时，Execution、Action 状态、Observation 和新的 Agent Run 也在同一个事务里产生，保证第 14 节的 Result → Observation 不会断链。

## 49.3 Agent Engine 的默认实现

`AgentEngine` 接口包含 `run(input)` 与 `converse(input)` 两个方法，产品代码里只有一个实现：`PIAgentEngine`，走 OpenAI 兼容的 Chat Completions 协议，由 `AGENT_ENGINE_*` 环境变量配置。真实的 PI Agent 服务接入时，只需要改 `PIAgentEngine` 内部的调用和解析，Runtime、Context Builder 和工具层都不受影响。

`converse` 是 Chat 的对话能力：Runtime 组装项目背景与最近会话历史，Engine 返回纯文本回复，不产生任何项目变更。`POST /chat` 在一次请求里完成“对话 → 落消息 → 提交 `conversation` Observation”三步；Observation 的内容是这段会话的全部问答记录，思考据此判断项目是否需要变化。思考的产出坚持宁缺毋滥：没有新信息的讨论只产生 judgment，不产出事件、提案、行动或建议，这是对 Engine 输出协议的明确要求。思考 Run 的 judgment 不再回写会话消息，对话流里只有真正的问答，思考结果由前端按 Run 单独拉取展示。

产品运行路径上不存在模拟或占位实现：Agent 产出的每一条 State、Event、Action、Recommendation 都来自真实 Engine。端到端测试需要可复现的输入输出，因此测试目录里自带一个只用于测试的确定性 Engine 替身，通过 `setEngine()` 注入；它不参与任何产品路径，也不进入构建产物。真实 Engine 的连通性由 `test/pi-engine.test.ts` 单独覆盖，需要显式开启。

## 49.4 Tool Calling 的现状

第 30、31 节的 Tool Registry 已按第 22 节的分层落地：Agent Engine 负责生成 `tool_calls`，Runtime 提供工具执行器并负责权限、数据库写入和 `tool_calls` 记录。MVP 实现三个工具：`get_project_state`、`create_action`、`complete_action`。

`create_action` 创建的 Action 遵循同一个确认闸门（先 `proposed`），`complete_action` 复用 Event→Action 关联的 `agent` 类型执行记录。工具和结构化输出可以并存：Agent 既可能先调工具再给最终输出，也可能只走结构化输出；最终输出里如果又列出了工具已经创建的 Action，会按标题去重，不会重复建。

## 49.5 人工确认闸门

第 25 节的分级确认在第一版按“自动 / 建议确认”两档落地：

- 现状整理（`current_situation`、`context`）自动应用。
- 结构性 State 变更（阶段、开放问题、风险、未知项）先写入 `state_proposals`，用户 apply 后才生效。
- Agent 产出的 Action 先处于 `proposed`，用户 confirm 后进入 `pending`，decline 则取消；用户自己创建的 Action 不需要确认。
- Project 完成由 Agent 提出 `type=completion` 的 Recommendation，用户确认后 Runtime 校验没有未完成 Action 和开放问题，再进入 Completed。

这样“LLM 只提议，用户确认后 Runtime 才落库”的原则，覆盖到了 Action、State 和 Project 完成三条路径。

## 49.6 Event 与 Action 的关联、event 型 Schedule

第 28 节的 Event → Action 关联落地为：Agent 在输出里引用已有 Action 的 `id` 并给出 `status`，Runtime 据此记录一次 agent 类型的 Execution、更新 Action 状态并写 Observation，而不新建 Action，也不重复触发 Run（当前这次 Run 本身就在处理这个事件）。

第 35 节的 Schedule 补齐了 `event` 类型：项目里出现匹配类型的事件时触发 Agent，匹配键是 `schedule.payload.event_type`。`manual` 类型仍然只保存不自动触发。

## 49.7 Risk Engine 与 Notification

风险不靠模型编造，而是 Risk Engine 从既有数据里确定性计算：Action 长期无进展、同一 Action 连续失败、Project 长时间没有变化三类。每次 Agent Run 结束后，新建议和风险会生成一条 `notifications` 记录，用 `dedup_key` 去重，避免同一条判断反复打扰用户。通知围绕“Agent 认为值得你知道”，而不是原始更新提醒。

## 49.8 Action 的结构化执行结果

第 14 节的 Result → Observation 不能只是“改一个状态”。Action 现在带 `kind`（task / meeting / document），完成时按种类采集结构化结果：会议采参与人、纪要、决定、后续行动；资料采要点和内容；任务采结果、阻塞和说明。结构化数据写入 `executions.output`，并整理成信息密集的文字写进 Observation，随 `recent_results` 一起回到 Agent 的上下文，Agent 才能基于“实际发生了什么”继续判断。
---

## 修改历史

- 2026-10-12：第 49.3 节更新 Chat 的对话与思考分离：`AgentEngine` 增加 `converse`，对话同步回复后自动提交 `conversation` Observation，judgment 不再回写会话消息。
- 2026-10-05：新增第 49 节，记录第一版实现中 Worker、事务边界、Agent Engine 和 Tool Calling 的落地方式。
- 2026-10-05：第 49.3 节改为只描述真实 Engine；确定性实现从产品代码移到测试目录，仅在测试中注入。
- 2026-10-05：新增第 49.5 节，记录人工确认闸门在 Action、State、Project 完成三条路径上的实现。
- 2026-10-05：新增第 49.6 节，记录 Event→Action 关联和 event 型 Schedule 的实现。
- 2026-10-05：新增第 49.7 节，记录 Risk Engine 与 Notification 的实现。
- 2026-10-05：新增第 49.8 节，记录 Action 按 kind 采集结构化执行结果。
- 2026-10-05：第 49.4 节更新为已实现，记录 Tool Registry 的三个工具与确认闸门的复用。
