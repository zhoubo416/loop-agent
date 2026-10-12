# MVP 开发计划

## 1. MVP 目标

LOOP MVP 的目标不是做一个完整的项目管理系统。

而是验证一个核心能力：

> **一个 Project 能否真正作为一个长期运行的 Agent，持续观察项目变化、理解当前状态、产生下一步行动，并根据执行结果继续运行。**

MVP 必须跑通：

```text
Project
   ↓
Observation
   ↓
Agent Run
   ↓
Think
   ↓
Recommendation / Action
   ↓
Execute
   ↓
Result
   ↓
Observation
   ↓
Agent Run
   ↓
...
```

最终形成一个完整闭环。

---

# 2. MVP 成功标准

MVP 不以页面数量作为成功标准，而以 Agent Loop 是否真正运行作为标准。

至少能够完成以下场景：

### 场景 1：创建 Project

用户创建：

```text
Project：
蛋白 X 机制研究

Objective：
验证蛋白 X 是否影响肿瘤细胞增殖。
```

系统创建 Project Agent。

---

### 场景 2：用户输入信息

用户通过 Chat 输入：

> 我们已经完成第一轮实验，结果基本符合预期。

系统产生：

```text
Observation
    ↓
Agent Run
    ↓
Event
第一轮实验完成

State Update
当前项目进入下一阶段

Recommendation
建议分析实验数据

Action
分析第一轮实验数据
```

---

### 场景 3：用户确认 Action

用户确认：

```text
分析第一轮实验数据
负责人：张三
```

Action 创建。

---

### 场景 4：Action 执行完成

用户告诉 Agent：

> 第一轮实验数据已经分析完成，结果比较稳定。

系统：

```text
Observation
    ↓
Event
数据分析完成
    ↓
Action
分析实验数据
    ↓
Completed
    ↓
Agent Run
    ↓
Recommendation
下一步进行第二轮实验
```

---

### 场景 5：Agent 主动运行

Schedule 触发：

```text
每天 09:00
    ↓
Wake Agent
    ↓
检查 Project
    ↓
发现 Action 已经 7 天没有变化
    ↓
Recommendation
提醒用户
```

---

### 场景 6：Project 完成

当：

```text
Success Criteria satisfied
+
Critical Open Issue = 0
+
Necessary Action = 0
```

Agent 提议：

> 当前 Project 已经达到完成条件。

用户确认后：

```text
Project → Completed
```

---

# 3. MVP 技术范围

MVP 包含：

```text
Frontend
Backend API
LOOP Runtime
Database
PI Agent Adapter
Schedule Worker
```

架构：

```text
                LOOP Web
                   │
                   ↓
                API
                   │
                   ↓
            LOOP Runtime
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
      State      Memory    Schedule
        │          │          │
        └──────────┼──────────┘
                   ↓
             Agent Engine
                   ↓
                PI Agent
```

---

# 4. 技术优先级

开发顺序不要按照页面顺序，而应该按照 Agent Loop 顺序。

优先级：

```text
P0  Project
P0  Observation
P0  Agent Run
P0  State
P0  Agent Engine Adapter
P0  Action
P0  Execution
P0  Result → Observation
P0  Chat

P1  Recommendation
P1  Timeline
P1  Schedule

P2  Memory
P2  Risk
P2  Notification

P3  高级功能
```

---

# 5. 第一阶段：基础工程

## 目标

建立项目基础设施，使后续 Runtime、API、Frontend 都能够独立开发。

### Backend

完成：

```text
项目结构
配置管理
数据库连接
Migration
认证
Project isolation
日志
错误处理
```

### Database

首先创建：

```text
users
projects
project_users
agent_states
sessions
session_messages
observations
events
actions
executions
recommendations
schedules
agent_runs
tool_calls
```

按照 `02-database-design.md` 建立数据库。

---

## 验收标准

可以：

```text
创建 User
    ↓
创建 Project
    ↓
添加 Project Member
    ↓
查询 Project
```

并确保：

> Project A 的数据无法访问 Project B。

---

# 6. 第二阶段：Project Agent Runtime

这是整个 MVP 最重要的阶段。

## 目标

实现：

```text
Trigger
 ↓
Agent Run
 ↓
Context
 ↓
PI Agent
 ↓
Output
 ↓
Persist
```

---

## 6.1 Agent Run

实现 Agent Run 状态：

```text
pending
   ↓
running
   ↓
completed

失败：

running
   ↓
failed
```

支持：

```text
user
observation
schedule
event
api
system
```

Trigger。

---

## 6.2 Runtime Orchestrator

核心流程：

```text
receive trigger
      ↓
create Agent Run
      ↓
load Project
      ↓
load State
      ↓
load recent Observations
      ↓
load active Actions
      ↓
build Context
      ↓
call Agent Engine
      ↓
parse Output
      ↓
validate Output
      ↓
persist changes
      ↓
complete Agent Run
```

---

# 7. 第三阶段：PI Agent Adapter

PI Agent 不直接暴露给业务层。

建立：

```text
AgentEngine
```

接口。

例如：

```text
AgentEngine
├── run()
├── executeTool()
└── healthCheck()
```

PI 实现：

```text
PIAgentEngine
```

未来可以增加：

```text
OpenAIAgentEngine
ClaudeAgentEngine
CustomAgentEngine
```

---

# 8. Agent Output Protocol

PI Agent 不能直接修改数据库。

Agent 输出结构化结果：

```json
{
  "judgment": "...",
  "state_proposal": {},
  "events": [],
  "actions": [],
  "recommendations": []
}
```

Runtime 负责：

```text
Agent Output
      ↓
Validation
      ↓
State Proposal
      ↓
Human Confirmation（必要时）
      ↓
Persist
```

这样可以避免：

> LLM 直接修改数据库。

---

# 9. 第四阶段：Observation Pipeline

Observation 是 LOOP 的统一输入层。

实现：

```text
POST /observations
```

支持：

```text
user_input
meeting
document
action_result
external_event
schedule
api
system
```

---

## Observation Pipeline

```text
Observation
     ↓
Queue
     ↓
Agent Run
     ↓
Think
     ↓
Event / Action / Recommendation
```

---

# 10. Chat

Chat 是 MVP 第一种 Observation 来源。

流程：

```text
User
 ↓
POST /chat
 ↓
Session
 ↓
Observation
 ↓
Agent Run
 ↓
PI Agent
 ↓
Output
 ↓
State / Event / Action
 ↓
Response
```

---

## Chat 示例

用户：

> 第一轮实验已经完成了，结果不错。

Agent：

> 我记录到第一轮实验已经完成。根据当前项目状态，下一步应该分析实验数据。我建议创建一个“分析第一轮实验数据”的行动。

用户：

> 可以。

系统：

```text
Action Created
```

---

# 11. 第五阶段：State

实现 Project 当前状态。

核心：

```text
agent_states
```

包括：

```text
current_stage
current_situation
open_issues
active_actions
risks
unknowns
context
```

---

## State 更新

不能直接：

```text
UPDATE state
```

而应该：

```text
Agent Proposal
      ↓
Validation
      ↓
Version Check
      ↓
Transaction
      ↓
State Update
      ↓
State Version
```

使用 optimistic locking：

```text
version
```

避免多个 Agent Run 同时修改 State。

---

# 12. 第六阶段：Action

Action 是 Agent 的执行出口。

实现：

```text
创建 Action
查询 Action
完成 Action
取消 Action
```

核心状态：

```text
pending
running
completed
failed
cancelled
```

---

## Action 与 Event

必须实现：

```text
Action
   ↓
Execution
   ↓
Result
   ↓
Observation
   ↓
Event
```

以及：

```text
Event
   ↓
Agent Think
   ↓
Action
```

形成双向循环。

---

# 13. Execution

Action 与 Execution 分离。

例如：

```text
Action
“分析实验数据”
```

可以有多次执行：

```text
Execution #1
失败

Execution #2
成功
```

因此：

```text
Action
 ├── Execution 1
 ├── Execution 2
 └── Execution 3
```

MVP 先支持：

```text
human execution
```

系统执行记录即可。

未来再加入：

```text
agent execution
system execution
```

---

# 14. Result → Observation

这是 Agent Loop 能否成立的关键。

Action 完成以后不能只：

```text
Action.status = completed
```

应该产生：

```text
Execution Result
      ↓
Observation
      ↓
Agent Run
      ↓
Think
```

例如：

```text
Action:
分析实验数据

↓

Execution:
完成

↓

Result:
实验结果符合预期

↓

Observation

↓

Agent

↓

Recommendation:
进入第二轮实验
```

这样系统才是真正的 Loop。

---

# 15. 第七阶段：Recommendation

Recommendation 是 Agent 主动性的主要表现。

实现：

```text
pending
accepted
rejected
expired
executed
```

例如：

```text
AI Recommendation

当前实验结果已经完成分析。

建议：
进入第二轮实验。

[接受]
[拒绝]
```

用户接受以后：

```text
Recommendation
      ↓
Action
```

---

# 16. 第八阶段：Schedule

Schedule 是 Agent 长期运行能力的重要组成部分。

实现：

```text
once
interval
cron
event
manual
```

核心机制：

```text
Scheduler
    ↓
找到到期 Schedule
    ↓
创建 Trigger
    ↓
Agent Run
    ↓
Agent
```

---

## Schedule Worker

不要让 Web API 负责定时执行。

采用：

```text
Scheduler
   ↓
Queue
   ↓
Worker
```

避免：

* Web 服务重启导致任务丢失
* 多实例重复执行
* 长任务阻塞 API

---

# 17. Schedule 幂等

必须保证：

> 同一个 Schedule 在同一个执行窗口只能产生一次 Agent Run。

可以使用：

```text
schedule_id
+
scheduled_at
```

生成唯一执行标识。

例如：

```text
schedule:123
2026-10-05T09:00
```

作为 deduplication key。

---

# 18. 第九阶段：Timeline

Timeline 不需要额外创建复杂业务模型。

由已有数据组合：

```text
Observation
Event
Recommendation
Action
Execution
State Change
```

按照时间排序。

例如：

```text
10:00 Event
实验完成

10:02 Recommendation
建议分析数据

10:05 Action
分析实验数据

11:30 Execution
执行完成

11:31 Event
实验数据符合预期
```

---

# 19. 第十阶段：前端 MVP

前端按照 `05-frontend-ui-design.md` 实现。

页面：

```text
Project List
Project Overview
Project Chat
Project Timeline
Actions
Action Detail
Project Settings
```

---

# 20. 前端开发顺序

不要先做完整视觉设计。

按照以下顺序：

### 1

Project List

### 2

Project Overview

### 3

Chat

### 4

Action

### 5

Timeline

### 6

Settings

最后统一优化视觉。

---

# 21. Project Overview 首先实现

首页只需要：

```text
Project Objective

Current State

Open Issues

AI Recommendation

Active Actions

Recent Activity
```

先确保数据是真实来自 Runtime。

不要先使用 Mock 数据做完整页面。

---

# 22. Chat 前端

Chat 需要支持：

```text
发送消息
Agent processing
Agent response
Recommendation
Action proposal
确认
```

例如：

```text
User Message
      ↓
Agent Working
      ↓
Agent Response

发现新的 Action：

[分析实验数据]

[确认]
```

---

# 23. 第十一阶段：Memory

Memory 不作为 MVP 的核心阻塞项。

第一版可以先使用：

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

构建 Agent Context。

Memory 表已经存在，但可以先只实现基础能力：

```text
create
query
```

暂时不实现复杂的：

```text
semantic retrieval
memory graph
自动合并
复杂记忆评分
```

---

# 24. Memory 第一版

当 Agent 判断某条信息具有长期价值时：

```text
Memory

type:
decision

content:
项目决定暂时停止路线 A。

source:
Agent Run #1024
```

后续 Agent Context Builder 可以读取。

---

# 25. 第十二阶段：并发与可靠性

这一阶段非常重要。

LOOP 是长期运行系统，因此不能只考虑：

> 正常情况下能不能跑。

必须处理：

```text
重复 Trigger
Agent Run 并发
Worker 崩溃
PI 调用失败
数据库事务失败
Action 执行失败
Schedule 重复执行
```

---

## Project Run Lock

同一个 Project：

```text
同一时刻只允许一个有效 Agent Run
修改 Project State。
```

例如：

```text
Project A

Run #101
running

Run #102
pending
```

Run #102 等待：

```text
Run #101
   ↓
complete
   ↓
Run #102
```

而不是同时修改 State。

---

# 26. Idempotency

所有可能重复执行的操作都需要支持幂等。

重点：

```text
Observation
Agent Run
Schedule
Action Execution
State Update
```

例如：

```text
POST /observations
Idempotency-Key: xxx
```

重复请求不能产生两个 Observation。

---

# 27. 第十三阶段：Agent 主动运行

完成 Schedule 后，开始验证：

> Agent 是否真的能够主动工作？

测试：

```text
Project
   ↓
Schedule
   ↓
Wake
   ↓
检查 State
   ↓
发现问题
   ↓
Recommendation
   ↓
Notification
```

例如：

```text
每天 09:00

Agent：
检查所有 Active Action。

发现：

Action A
已经 7 天没有变化。

↓

Recommendation

“Action A 已经连续 7 天没有进展，
建议确认当前执行是否遇到问题。”
```

这一步完成后，LOOP 才真正区别于普通 Chat Agent。

---

# 28. 第十四阶段：完整 Loop 测试

必须做端到端测试。

测试：

```text
创建 Project
 ↓
输入 Observation
 ↓
Agent Run
 ↓
产生 Event
 ↓
产生 Recommendation
 ↓
创建 Action
 ↓
Action Execution
 ↓
产生 Result
 ↓
Result → Observation
 ↓
Agent Run
 ↓
产生新的 Action
 ↓
...
```

最终：

```text
Success Criteria
满足

↓

Agent Recommendation
项目可以完成

↓

User Confirm

↓

Project Completed
```

---

# 29. MVP 测试用例

至少覆盖以下场景。

## Case 1：普通输入

```text
用户输入
 ↓
Observation
 ↓
Agent
 ↓
State Update
```

---

## Case 2：产生 Action

```text
Observation
 ↓
Agent
 ↓
Action
```

---

## Case 3：用户拒绝 Recommendation

```text
Recommendation
 ↓
Reject
 ↓
Project State 不发生错误变化
```

---

## Case 4：Action 完成

```text
Action
 ↓
Execution
 ↓
Result
 ↓
Observation
 ↓
Agent
```

---

## Case 5：Action 失败

```text
Execution
 ↓
Failed
 ↓
Observation
 ↓
Agent
 ↓
新的 Recommendation
```

---

## Case 6：Schedule

```text
Schedule
 ↓
Trigger
 ↓
Agent Run
```

---

## Case 7：重复 Schedule

同一个时间窗口只产生一次 Run。

---

## Case 8：并发 Run

两个 Trigger 同时到达：

```text
Run A
Run B
```

不能同时修改 State。

---

## Case 9：Project Isolation

```text
Project A
```

不能读取：

```text
Project B
```

的：

```text
State
Memory
Observation
Session
Action
```

---

## Case 10：Project Completion

验证：

```text
Success Criteria
+
Open Issue
+
Necessary Action
```

满足完成条件后才能进入：

```text
Completed
```

---

# 30. 推荐开发顺序

完整开发顺序：

```text
Phase 1
基础工程
    ↓
Phase 2
Project + Database
    ↓
Phase 3
Agent Runtime
    ↓
Phase 4
PI Agent Adapter
    ↓
Phase 5
Observation
    ↓
Phase 6
State
    ↓
Phase 7
Action + Execution
    ↓
Phase 8
Recommendation
    ↓
Phase 9
Chat
    ↓
Phase 10
Timeline
    ↓
Phase 11
Schedule
    ↓
Phase 12
Memory
    ↓
Phase 13
Reliability
    ↓
Phase 14
E2E Loop
```

---

# 31. MVP 最小可用版本

如果开发时间有限，可以进一步压缩。

真正不可删的是：

```text
Project
Observation
Agent Run
State
PI Adapter
Action
Execution
Chat
```

核心链路：

```text
Chat
 ↓
Observation
 ↓
Agent Run
 ↓
PI Agent
 ↓
State
 ↓
Action
 ↓
Execution
 ↓
Result
 ↓
Observation
```

只要这条链路跑通：

> LOOP MVP 就成立。

---

# 32. 可以延后的功能

以下功能不应该阻塞 MVP：

```text
Memory semantic search
复杂 Risk Engine
Notification Center
多 Agent
Agent Marketplace
复杂权限
复杂报表
文件知识库
向量数据库
复杂会议系统
复杂 Schedule UI
移动端
```

这些属于后续增强能力。

---

# 33. 开发团队拆分

如果一个人开发：

```text
Backend
 ↓
Database
 ↓
Runtime
 ↓
PI Adapter
 ↓
API
 ↓
Frontend
 ↓
Schedule
 ↓
Test
```

如果多人开发：

### Backend

负责：

```text
Database
API
Project
Observation
Action
State
```

### Agent Runtime

负责：

```text
Agent Run
Context
PI Adapter
Output Protocol
Loop
Schedule
Queue
```

### Frontend

负责：

```text
Project
Overview
Chat
Timeline
Action
Settings
```

### QA

负责：

```text
E2E
Concurrency
Idempotency
Isolation
Failure Recovery
```

---

# 34. MVP 开发原则

## 原则一：先跑通 Loop

不要先把 UI 做漂亮。

优先：

```text
Observation
→
Think
→
Action
→
Result
→
Observation
```

---

## 原则二：Runtime 优先于功能

如果：

```text
Chat
Meeting
Schedule
Document
```

都只是不同 Observation 来源，那么应该优先把：

```text
Observation → Agent Run
```

做好。

之后增加输入方式非常容易。

---

## 原则三：PI Agent 只是 Engine

业务代码不要写：

```text
if PI ...
```

而应该：

```text
AgentEngine
```

通过 Adapter 调用。

---

## 原则四：不要让 LLM 直接操作数据库

LLM：

```text
Proposal
```

Runtime：

```text
Validate
Persist
```

---

## 原则五：不要过早建设 Memory

第一版上下文：

```text
Objective
+
State
+
Recent Observation
+
Active Action
+
Recent Result
```

已经足够验证核心产品。

---

## 原则六：不要把 Action 做成 Todo

Action 的产生应该有原因：

```text
Event
 ↓
Think
 ↓
Action
```

而不是：

```text
用户创建 Todo
```

---

# 35. MVP 最终架构

完成后系统应该达到：

```text
                         LOOP
                          │
                    ┌─────┴─────┐
                    │  Project  │
                    │   Agent   │
                    └─────┬─────┘
                          │
                       Observe
                          │
                          ↓
                    ┌───────────┐
                    │ Agent Run │
                    └─────┬─────┘
                          │
                        Think
                          │
              ┌───────────┼───────────┐
              ↓           ↓           ↓
            State       Event    Recommendation
              │                       │
              │                       ↓
              │                    Action
              │                       │
              │                   Execution
              │                       │
              │                       ↓
              │                     Result
              │                       │
              └───────────┬───────────┘
                          ↓
                     Observation
                          │
                          ↓
                     Agent Run
                          │
                         ...
```

---

# 36. MVP 最终验收标准

LOOP MVP 完成必须满足：

### Project

* [ ] 可以创建 Project
* [ ] Project 是 Agent 的业务身份
* [ ] 支持 Project Member
* [ ] Project 数据完全隔离

### Agent Runtime

* [ ] 可以创建 Agent Run
* [ ] 支持 Trigger
* [ ] 支持 Context Builder
* [ ] 支持 PI Agent Adapter
* [ ] 支持结构化 Agent Output
* [ ] 支持 State Update

### Observation

* [ ] 可以产生 Observation
* [ ] Chat 可以产生 Observation
* [ ] Action Result 可以产生 Observation

### State

* [ ] 可以读取 Current State
* [ ] Agent 可以提出 State Proposal
* [ ] 支持 State Version
* [ ] 支持并发控制

### Action

* [ ] Agent 可以产生 Action
* [ ] 用户可以确认 Action
* [ ] Action 可以执行
* [ ] Action 可以完成/失败/取消
* [ ] Execution 可以产生 Result

### Recommendation

* [ ] Agent 可以产生 Recommendation
* [ ] 用户可以接受
* [ ] 用户可以拒绝

### Schedule

* [ ] 可以创建 Schedule
* [ ] Scheduler 可以触发 Agent
* [ ] Schedule 支持幂等

### Loop

* [ ] Observation 可以触发 Agent
* [ ] Agent 可以产生 Action
* [ ] Action Result 可以再次触发 Agent
* [ ] Agent 可以持续循环

### Project Completion

* [ ] Agent 可以判断 Project 是否接近完成
* [ ] 用户可以确认完成
* [ ] Project 可以进入 Completed

---

# 37. MVP 的最终判断

LOOP MVP 不需要证明：

> AI 能不能做好项目管理。

只需要证明：

> **Project 能不能变成一个真正持续运行的 Agent。**

如果以下过程可以稳定运行：

```text
Project
 ↓
Observe
 ↓
Think
 ↓
Act
 ↓
Result
 ↓
Observe
 ↓
Think
 ↓
Act
 ↓
...
```

那么 LOOP 的核心技术和产品模型就已经被验证。

后续增加：

```text
Memory
Schedule
Risk
Document
Meeting
External Tools
Multi-Agent
```

都只是给这个 Loop 增加新的输入、能力和执行方式。

**因此 MVP 的核心不是“功能少”，而是“Loop 完整”。**

---

# 38. 实现现状与技术栈

## 38.1 技术栈

设计文档只规定了能力边界，没有指定语言和框架。第一版实现选定：

```text
后端      Node 20+ / TypeScript / Fastify
数据库    PostgreSQL（Neon 托管）/ PGlite（可选的内嵌本地数据库）
前端      Nuxt 4 / Vue 3 / Nuxt UI 4
Agent     Agent Engine Adapter + 真实 PI Agent 服务（OpenAI 兼容协议）
```

仓库结构：

```text
apps/api    后端 API、Agent Runtime、数据库 migration
apps/web    前端控制台
docs/       设计文档与 Memory
```

一些实现取舍：

- 默认连接 `DATABASE_URL` 指向的真实 PostgreSQL；没有配置时回落到内嵌 PGlite，两者共用同一份 migration 和同一套 SQL。托管数据库会回收空闲连接，因此连接池设置了更短的 `idleTimeoutMillis`，并对连接层错误做一次重试。
- Queue 直接用 `agent_runs` 表，待运行任务是 `status = 'pending'` 的记录，认领用 `FOR UPDATE SKIP LOCKED`，不额外引入消息队列。Worker 崩溃后任务仍留在表里，重启继续执行。
- Agent 的每一次运行都调用真实的 Agent 服务，产品代码里没有 mock 引擎，也没有任何预置的示例数据。前端看到的 State、Event、Action、Recommendation 全部由真实 Agent 产出。

## 38.2 阶段完成情况

```text
Phase 1  基础工程          完成：项目结构、配置、数据库连接、Migration、身份、隔离、错误格式
Phase 2  Project + Database 完成：16 张业务表 + state_proposals + 3 张可靠性支撑表
Phase 3  Agent Runtime     完成：Agent Run 状态机、Context Builder、Output Processor
Phase 4  PI Agent Adapter  完成：AgentEngine 接口 + OpenAI 兼容的真实 Agent 服务接入
Phase 5  Observation       完成：统一入口，Chat 与 Action Result 都走它
Phase 6  State             完成：State Proposal、version 乐观锁、State 历史、人工确认
Phase 7  Action + Execution 完成：创建、指派人、确认、拒绝、完成、失败、取消、事件关联
Phase 8  Recommendation    完成：接受（可生成 Action）、拒绝、完成建议
Phase 9  Chat              完成：Session + Observation + 轮询 Run
Phase 10 Timeline 与前端    完成：Overview、Chat、Timeline、Actions、Action Detail、Settings
Phase 11 Schedule          完成：cron/interval/once/event，按执行窗口去重
Phase 12 Memory            基础完成：create 与 query，未做语义检索
Phase 13 可靠性             完成：请求幂等、Schedule 去重、Project 锁、State 乐观锁、重试
Phase 14 E2E Loop          完成：apps/api/test/loop.test.ts 覆盖第 29 节 Case 1-10
```

第 25 节的人工确认闸门落地后，Agent 的产出一部分自动生效（现状整理），一部分先待确认（结构性 State 变更、Action 提议、Project 完成），用户在界面上一键确认或忽略。身份解析也不再做无头请求回落，业务接口都要求 `X-User-Id`。

此外还补上了 Event→Action 关联、event 型 Schedule、timeline 游标分页、幂等键过期回收和 Project 归档入口。

第 22-24 节的 Tool Calling 也已启用：`get_project_state`、`create_action`、`complete_action` 三个工具由 Runtime 的 Tool Registry 提供，真实 Agent 服务在多轮循环里调用，`tool_calls` 表有完整记录。

P2 的 Notification 与 Risk 也已落地：Risk Engine 确定性计算三类风险，Agent Run 结束后生成去重后的通知，前端有通知铃铛和通知页。

登录与注册也已落地：邮箱密码注册/登录、Bearer 令牌鉴权、登出，前端有登录页和退出入口；Settings 页补上了 Success Criteria 编辑和归档。

Action 不再只是翻状态：带 `kind`（task / meeting / document），完成时按类型采集结构化结果并写回 Agent 上下文。

前端把 Action 详情按类型拆成三个独立页面（会议页 / 任务页 / 资料页），列表和 Overview 按 kind 跳转到对应页面，完成、失败、取消都在详情页上操作。

## 38.3 尚未实现

以下能力不影响 Loop 闭环，留到后续阶段：

```text
WebSocket / SSE 实时推送（当前前端轮询 Run 状态）
Memory 语义检索与自动整理
agent / system 两类 Action 执行器的自动执行
密码找回 / 邮箱验证 / 第三方登录（登录注册已有，这些是增强）
腾讯会议内容同步（第一版实现后移除，会议记录暂时手工填写）
```

---

## 修改历史

- 2026-10-05：新增第 38 节，记录第一版实现选定的技术栈、仓库结构、阶段完成情况和尚未实现的能力。
- 2026-10-05：第 38 节更新为真实运行形态：前端升级到 Nuxt 4 与 Nuxt UI 4，Agent 只连真实服务，移除 mock 引擎与示例数据，并补充托管数据库的连接处理。
- 2026-10-05：第 38.2 节补充人工确认闸门、Project 完成闭环和鉴权收紧的落地情况。
- 2026-10-05：第 38 节补充登录/注册、通知与 Settings 页的落地情况，更新“尚未实现”清单。
- 2026-10-05：第 38 节补充 Action 按类型拆分详情页（会议/任务/资料）与结构化执行结果。
