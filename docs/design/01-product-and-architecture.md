# LOOP Agent 系统设计说明书

## 1. 产品定义

### 1.1 核心定义

LOOP 不是一个给项目增加 AI 助手的项目管理工具。

LOOP 的核心是：

> **一个项目，就是一个 Agent。**

这个 Agent 围绕项目目标长期存在，并持续感知项目发生的变化、理解当前状态、进行判断、提出下一步行动，并根据执行结果继续循环。

```text
Project
   ↓
Agent
   ↓
Observe
   ↓
Think
   ↓
Action
   ↓
Result
   ↓
Update State
   ↓
Observe
   ↓
Think
   ↓
...
```

项目可以由一个人，也可以由多个人共同推进。

因此：

```text
Project
 ├── User A
 ├── User B
 ├── User C
 └── User D
```

这些用户共同参与同一个 Agent。

**Agent 不属于某个 User，而属于 Project。**

---

# 2. LOOP 与传统项目管理的区别

传统项目管理通常是：

```text
Project
   ↓
Plan
   ↓
Task 1
Task 2
Task 3
   ↓
Complete
```

这种方式假设项目路径可以提前规划。

但很多真实项目，特别是科研、产品研发、创业、技术探索等项目，并不是这样。

真实过程更接近：

```text
目标
 ↓
当前状态
 ↓
思考
 ↓
采取行动
 ↓
获得结果
 ↓
发现新信息
 ↓
改变对项目的理解
 ↓
再次思考
 ↓
采取新的行动
 ↓
...
```

因此 LOOP 管理的不是固定任务列表，而是：

> **一个不断变化的目标状态。**

核心不是：

> “还有多少任务没有完成？”

而是：

> **“为了实现这个项目目标，现在最需要做什么？”**

---

# 3. 核心对象

LOOP 的核心对象关系：

```text
Project / Agent
│
├── Project Members
│
├── State
│
├── Memory
│
├── Sessions
│
├── Observations
│
├── Events
│
├── Actions
│
├── Executions
│
├── Recommendations
│
├── Schedules
│
└── Agent Runs
```

其中：

### Project

项目本身，同时也是 Agent 的主体。

包含：

* 项目名称
* 项目目标
* 项目描述
* 成功标准
* 约束
* 当前状态
* 生命周期状态

### User

项目参与者。

一个 Project 可以有多个 User：

```text
Project
   ├── User A
   ├── User B
   └── User C
```

### Agent

Agent 不需要成为一个独立的业务主体。

从产品语义上：

```text
Project = Agent
```

从技术实现上，可以把 Agent Runtime 看作：

> **负责让 Project 持续运行的运行时。**

因此第一版甚至可以不建立独立的 `agents` 表，而直接使用：

```text
project_id
```

作为 Agent 的唯一身份。

---

# 4. Project = Agent

这是 LOOP 最重要的设计原则。

例如：

```text
项目：

开发一个 AI 科研项目管理系统
```

这个项目本身就是：

```text
Agent：

开发一个 AI 科研项目管理系统
```

它拥有自己的：

```text
Goal
State
Memory
Observation
Action
Schedule
Session
```

用户不是在“使用一个 AI 帮手”。

而是在：

> **与这个项目本身进行交互。**

例如：

```text
用户：

我们今天把实验方案确定了。

Project Agent：

收到。

当前项目状态发生变化：
实验方案已经确定。

接下来还有两个问题：
1. 实验材料还没有准备
2. 第一轮实验时间尚未确定

建议下一步：
确认实验时间，并准备实验材料。
```

Agent 始终围绕项目本身，而不是围绕某个用户。

---

# 5. Project 与 User 的关系

Project 与 User 是多对多关系。

```text
User
 │
 ├────────────┐
 ↓            ↓
Project A    Project B
 ↑
 │
 ├── User A
 ├── User B
 └── User C
```

因此需要：

```text
project_users
```

作为项目成员关系表。

成员可以具有不同角色：

```text
owner
admin
member
viewer
```

但角色只是权限概念。

无论谁参与项目：

> **他们面对的是同一个 Project Agent。**

---

# 6. Agent 的核心循环

LOOP 的完整运行循环：

```text
                Project
                   │
                   ↓
             Current State
                   │
                   ↓
              Observation
                   │
                   ↓
                 Think
                   │
                   ↓
               Judgment
                   │
                   ↓
            Recommendation
                   │
             Human Confirm
                   │
                   ↓
                Action
                   │
                   ↓
              Execution
                   │
                   ↓
                 Result
                   │
                   ↓
             Update State
                   │
                   ↓
                Memory
                   │
                   └──────────────→ Observation
```

它不是一次性的 Agent。

而是一个：

> **长期运行的状态循环。**

---

# 7. Observation

Observation 是 Agent 感知现实的入口。

定义：

> **发生了什么，或者系统获得了什么新的信息。**

Observation 不等于 Memory。

也不等于 Event。

它是 Agent 的“感知输入”。

来源包括：

* 用户输入
* 用户对话
* 项目会议
* Action 执行结果
* 任务完成
* 文档上传
* 实验结果
* 外部系统变化
* 定时触发
* 项目成员提交的信息
* API 调用
* 系统事件

例如：

```text
用户：

第二组实验已经完成，但是数据异常。
```

进入 Agent 后首先形成：

```text
Observation

第二组实验完成。
实验数据异常。
```

然后 Agent 才开始 Think。

---

# 8. Think

Think 是 Agent 对当前信息进行理解和判断的过程。

它需要综合：

```text
Project Goal
+
Current State
+
Recent Observations
+
Relevant Memory
+
Active Actions
```

然后判断：

```text
发生了什么？

这意味着什么？

是否改变了项目状态？

当前有什么问题？

是否需要行动？

下一步应该做什么？
```

Think 不应该直接修改项目的重要业务状态。

它产生的是：

```text
Judgment
Recommendation
```

---

# 9. Judgment

Judgment 表示 Agent 对当前情况形成的判断。

例如：

```text
Observation：

第二组实验数据异常。

Judgment：

当前实验结果不足以支持原来的结论，
需要进一步确认异常原因。
```

Judgment 可以包含：

```text
content
evidence
confidence
status
```

其中：

* content：判断内容
* evidence：判断依据
* confidence：置信程度
* status：当前是否有效

重要判断应该能够追溯到 Observation 或 Memory。

---

# 10. Recommendation

Recommendation 是 Agent 给出的下一步建议。

例如：

```text
Recommendation：

重新检查第二组实验条件。
```

或者：

```text
Recommendation：

建议暂停当前实验路线，
先确认异常是否由实验条件造成。
```

Recommendation 不一定自动执行。

根据 Action 的类型，可以要求：

```text
AI 提出
 ↓
用户确认
 ↓
执行
```

特别是涉及重要项目状态变化时，应尽量采用：

> **AI 提议 → 人确认 → 系统更新**

而不是 AI 直接修改。

---

# 11. Action

Action 是 Agent 希望改变现实或者获得新信息的行为。

例如：

```text
Action：
重新进行第二组实验
```

Action 可以由：

* 人执行
* Agent 执行
* 系统执行

例如：

```text
Human Action
实验人员重新进行实验

Agent Action
AI 分析实验数据

System Action
系统定期检查项目状态
```

Action 的状态：

```text
pending
running
completed
failed
cancelled
```

---

# 12. Event

Event 表示项目中已经发生的事实或状态变化。

例如：

```text
实验完成
实验失败
实验数据异常
会议结束
方案确定
供应商确认
代码上线
客户反馈
```

Event 和 Action 必须区分。

```text
Event：

实验失败

Action：

分析失败原因
重新进行实验
查找相关文献
```

关系：

```text
Event
 ├── Action A
 ├── Action B
 └── Action C
```

而 Action 执行完成后，又可能产生新的 Event：

```text
Action
 ↓
执行
 ↓
Result
 ↓
Event
 ↓
新的 Action
```

因此 LOOP 真正运行的是：

> **Event → Action → Event → Action**

而不是传统项目管理中的：

> Task → Task → Task

---

# 13. State

State 是 Agent 对项目当前情况的结构化理解。

它回答：

> **这个项目现在到底是什么情况？**

例如：

```json
{
  "current_stage": "实验验证",
  "current_situation": "第一组实验成功，第二组异常",
  "open_issues": [
    "第二组数据异常原因未知"
  ],
  "active_actions": [
    "检查实验条件"
  ],
  "risks": [
    "实验结果可能无法支持当前假设"
  ],
  "unknowns": [
    "第二组异常是否由实验条件造成"
  ]
}
```

State 是：

> **当前状态。**

Memory 是：

> **值得长期保留的过去信息。**

两者不能混为一谈。

---

# 14. Memory

Memory 是 Agent 从历史信息中提炼出来的长期有效信息。

不是所有聊天记录都应该成为 Memory。

例如：

```text
用户：

第二组实验异常。

```

首先产生：

```text
Observation
```

Agent 判断之后可能形成：

```text
Memory：

第二组实验已经连续两次出现异常。
```

或者：

```text
Memory：

团队决定后续实验统一使用方案 B。
```

Memory 可以分为：

```text
Event
Decision
Action
Conclusion
Context
```

Memory 应支持：

```text
create
update
merge
supersede
invalidate
```

例如：

```text
原方案：
实验温度 30℃

后来：

实验温度调整为 37℃
```

旧 Memory 不应该简单删除，而应该记录：

```text
旧结论 → superseded
新结论 → active
```

---

# 15. Session

Session 是一次短期交互上下文。

一个 Project Agent 可以有很多 Session：

```text
Project Agent
│
├── Session 1：项目讨论
├── Session 2：会议总结
├── Session 3：风险分析
├── Session 4：用户对话
└── Session 5：定时检查
```

Session 不等于 Agent。

也不等于 Memory。

它只是：

> **Agent 某一次运行或交互的上下文。**

一次 Session 内部可以调用 PI Agent 多次。

所以：

```text
LOOP Session
     │
     ├── PI Run
     ├── Tool Call
     ├── PI Run
     └── Tool Call
```

PI Session 只是底层执行上下文。

---

# 16. Schedule

Schedule 负责让 Agent 在没有用户主动操作时继续运行。

PI Agent 本身没有 Schedule，因此 Schedule 必须属于 LOOP Runtime。

例如：

```text
每天 9:00
    ↓
Wake Agent
    ↓
检查项目状态
    ↓
Think
    ↓
发现风险
    ↓
Recommendation
```

Schedule 类型：

```text
once
interval
cron
event
manual
```

例如：

```text
每周一 9:00
检查项目是否存在长期未完成 Action。

实验完成后
自动触发项目状态检查。

Action 超过 7 天没有变化
唤醒 Agent 检查。
```

Schedule 只负责：

> **什么时候让 Agent 醒来。**

它不负责 Think。

---

# 17. Trigger

Agent 可以由不同来源触发。

统一抽象为：

```text
Trigger
```

来源：

```text
User
Event
Schedule
API
System
```

例如：

```text
User
 ↓
发送消息

Event
 ↓
实验完成

Schedule
 ↓
每天 9:00

API
 ↓
外部系统提交新数据
```

最终都进入：

```text
Agent Runtime
```

然后：

```text
Observation
 ↓
Think
 ↓
Action
```

---

# 18. PI Agent 的定位

PI Agent 不是 LOOP Agent。

PI Agent 只是：

> **LOOP 的 Think + Execute Engine。**

LOOP 自己负责：

```text
Project
State
Memory
Observation
Session
Schedule
Lifecycle
Agent Loop
```

PI 负责：

```text
Think
Tool Calling
Execute
```

因此：

```text
                 LOOP
                   │
          Agent Runtime
                   │
          ┌────────┴────────┐
          ↓                 ↓
       Memory            Schedule
          │                 │
          └────────┬────────┘
                   ↓
              PI Adapter
                   ↓
               PI Agent
                   ↓
             Think / Execute
```

未来可以替换为：

```text
PI Agent
OpenAI Agent
Claude Agent
Custom Agent
其他 Agent Engine
```

LOOP 上层业务不应该感知这些区别。

---

# 19. LOOP Runtime

LOOP Runtime 是整个系统的核心。

它负责让 Project Agent 长期存在。

主要模块：

```text
LOOP Runtime
│
├── Project Manager
├── Member Manager
├── Session Manager
├── Observation Manager
├── State Manager
├── Memory Manager
├── Action Manager
├── Execution Manager
├── Schedule Manager
├── Recommendation Manager
├── Agent Loop
└── Agent Engine Adapter
```

核心职责：

```text
接收输入
 ↓
形成 Observation
 ↓
加载项目 State
 ↓
检索 Memory
 ↓
调用 Agent Engine
 ↓
获得 Judgment / Recommendation / Action
 ↓
执行
 ↓
获取 Result
 ↓
更新 State / Memory
 ↓
等待下一次 Trigger
```

---

# 20. Agent 生命周期

```text
Created
   ↓
Active
   ↓
Paused
   ↓
Active
   ↓
Completed
```

### Created

项目刚刚建立。

系统初始化：

```text
Project
Initial State
Initial Context
```

### Active

项目正常推进。

Agent 持续：

```text
Observe
Think
Act
Update
```

### Paused

项目暂时停止。

例如：

* 等待外部条件
* 暂时搁置
* 用户主动暂停

Paused 不代表完成。

### Completed

项目达到完成条件。

项目完成不应该简单等于：

```text
所有 Action completed
```

而应该是：

```text
Success Criteria satisfied
+
No Critical Open Issue
+
No Necessary Action
```

Agent 可以提出：

> “我认为这个项目已经达到完成条件。”

由用户确认后：

```text
Project → Completed
```

---

# 21. Project 成员协作

多个用户共同推进同一个 Agent。

例如：

```text
Project：开发 AI 项目管理系统

成员：
张三
李四
王五
```

张三：

```text
上传会议记录
```

形成：

```text
Observation
```

Agent 更新状态。

李四：

```text
完成 Action：数据库设计
```

形成：

```text
Observation
```

Agent 再次理解项目状态。

王五：

```text
提交新的技术方案
```

再次形成：

```text
Observation
```

所有人的行为最终汇入：

> **同一个 Project Agent。**

因此不是：

```text
User A Agent
User B Agent
User C Agent
```

而是：

```text
                 Project Agent
                /      |      \
           User A    User B    User C
```

---

# 22. Meeting / Dialogue / Document / Task 的定位

这些都不是 Agent。

也不是 Project 的平级核心主体。

它们都是：

> **推动 Project Agent 运行的输入方式或执行方式。**

例如：

### Meeting

```text
Meeting
 ↓
Observation
 ↓
Think
 ↓
Event / Decision / Action
```

### Dialogue

```text
Dialogue
 ↓
Observation
 ↓
Think
 ↓
Recommendation / Action
```

### Document

```text
Document
 ↓
Observation
 ↓
Think
 ↓
Project State Change
```

### Task

```text
Action
 ↓
Execution
 ↓
Result
```

因此在 LOOP 中：

```text
Project / Agent
│
├── Meeting
├── Dialogue
├── Document
├── Event
├── Action
├── Decision
└── Memory
```

这些都是围绕 Agent 运转的对象。

---

# 23. 数据模型

第一版建议采用 PostgreSQL。

核心关系：

```text
users
   │
   │ N:M
   ↓
project_users
   │
   ↓
projects
   │
   ├── agent_states
   ├── sessions
   ├── observations
   ├── memories
   ├── events
   ├── actions
   ├── executions
   ├── schedules
   ├── recommendations
   ├── tool_calls
   └── agent_runs
```

注意：

> **第一版不需要 agents 表。**

因为：

```text
Project = Agent
```

Project 的 `id` 就是 Agent 的业务身份。

如果未来需要支持一个 Project 下存在多个专业 Agent，再增加：

```text
agents
```

即可。

---

# 24. users

```text
users
├── id
├── name
├── email
├── avatar
├── created_at
└── updated_at
```

User 是系统用户。

User 不直接拥有 Agent。

---

# 25. projects

```text
projects
├── id
├── name
├── objective
├── description
├── success_criteria
├── constraints
├── status
├── current_stage
├── created_by
├── created_at
└── updated_at
```

其中：

### objective

项目最终想实现什么。

### description

项目背景和范围。

### success_criteria

什么情况下认为项目完成。

### constraints

项目受到的约束。

例如：

```text
时间
预算
人员
技术
合规
```

### status

```text
created
active
paused
completed
archived
```

---

# 26. project_users

```text
project_users
├── id
├── project_id
├── user_id
├── role
├── joined_at
└── created_at
```

关系：

```text
Project N:M User
```

角色：

```text
owner
admin
member
viewer
```

所有项目数据都通过 Project 进行隔离。

---

# 27. agent_states

```text
agent_states
├── id
├── project_id
├── current_stage
├── current_situation
├── open_issues
├── active_actions
├── risks
├── unknowns
├── context
├── version
├── created_at
└── updated_at
```

其中复杂状态建议使用 JSONB。

例如：

```json
{
  "current_stage": "实验验证",
  "current_situation": "第二组实验异常",
  "open_issues": [
    "异常原因未知"
  ],
  "risks": [
    "实验结果可能无法支持假设"
  ]
}
```

State 是项目当前的“脑内状态”。

---

# 28. sessions

```text
sessions
├── id
├── project_id
├── user_id
├── type
├── status
├── started_at
└── ended_at
```

Session 类型：

```text
chat
meeting
schedule
event
api
system
```

同一个 Project 可以有多个 Session。

---

# 29. session_messages

```text
session_messages
├── id
├── session_id
├── role
├── content
├── metadata
└── created_at
```

例如：

```text
user
assistant
system
tool
```

聊天记录属于 Session。

**聊天记录不是 Memory。**

---

# 30. observations

```text
observations
├── id
├── project_id
├── session_id
├── user_id
├── type
├── content
├── source
├── metadata
└── created_at
```

例如：

```text
type:
user_input
meeting
document
action_result
external_event
schedule
system
```

Observation 是 Agent 感知到的事实。

---

# 31. memories

```text
memories
├── id
├── project_id
├── type
├── content
├── source_type
├── source_id
├── confidence
├── status
├── superseded_by
├── created_at
└── updated_at
```

Memory 类型：

```text
event
decision
action
conclusion
context
```

状态：

```text
active
superseded
invalid
archived
```

---

# 32. events

```text
events
├── id
├── project_id
├── observation_id
├── type
├── title
├── content
├── status
├── occurred_at
└── created_at
```

Event 表示：

> 项目中已经发生的事情。

---

# 33. actions

```text
actions
├── id
├── project_id
├── event_id
├── title
├── description
├── executor_type
├── assignee_id
├── status
├── priority
├── due_at
├── created_at
└── updated_at
```

其中：

```text
executor_type
```

可以是：

```text
human
agent
system
```

一个 Event 可以产生多个 Action：

```text
Event
 ├── Action A
 ├── Action B
 └── Action C
```

---

# 34. executions

Action 不等于 Execution。

Action 是：

> 要做什么。

Execution 是：

> 这次具体执行发生了什么。

例如：

```text
Action：
分析实验数据

Execution 1：
张三第一次分析

Execution 2：
AI 第二次分析

Execution 3：
重新分析
```

结构：

```text
executions
├── id
├── action_id
├── executor_type
├── executor_id
├── input
├── output
├── status
├── started_at
└── completed_at
```

---

# 35. recommendations

```text
recommendations
├── id
├── project_id
├── judgment
├── type
├── content
├── priority
├── requires_confirmation
├── status
├── created_at
└── resolved_at
```

状态：

```text
pending
accepted
rejected
expired
executed
```

推荐可以产生 Action：

```text
Recommendation
      ↓
User Confirm
      ↓
Action
```

---

# 36. schedules

```text
schedules
├── id
├── project_id
├── type
├── expression
├── payload
├── status
├── next_run_at
├── last_run_at
├── created_at
└── updated_at
```

例如：

```text
每天 09:00
```

或者：

```text
Action 超过 7 天没有变化
```

Schedule 触发后：

```text
Schedule
 ↓
Trigger
 ↓
Observation
 ↓
Agent Run
```

---

# 37. agent_runs

虽然没有独立的 Agent 表，但需要记录 Agent 每次运行。

```text
agent_runs
├── id
├── project_id
├── session_id
├── trigger_type
├── trigger_id
├── input_context
├── output
├── status
├── started_at
└── completed_at
```

它表示：

> Project Agent 某一次实际运行。

例如：

```text
Project Agent Run #1024

Trigger:
schedule

Input:
当前 State + 最近 Observation + Relevant Memory

Result:
发现 Action 已经 8 天没有进展。

Recommendation:
提醒负责人确认。
```

---

# 38. tool_calls

用于记录 Agent 调用工具的过程。

```text
tool_calls
├── id
├── agent_run_id
├── tool_name
├── input
├── output
├── status
├── started_at
└── completed_at
```

例如：

```text
Agent
 ↓
调用搜索工具
 ↓
获取论文
 ↓
继续 Think
```

---

# 39. 最终 ER 关系

第一版核心关系可以简化成：

```text
                    ┌─────────────┐
                    │    Users    │
                    └──────┬──────┘
                           │
                           │ N:M
                           ↓
                    ┌─────────────┐
                    │ProjectUsers │
                    └──────┬──────┘
                           │
                           ↓
                    ┌─────────────┐
                    │   Project   │
                    │  = Agent    │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
       State            Memory          Sessions
          │                                 │
          │                                 ↓
          │                            Messages
          │
          ├──────────────┐
          ↓              ↓
    Observations       Events
                           │
                           ↓
                        Actions
                           │
                           ↓
                      Executions

Project
  │
  ├── Recommendations
  ├── Schedules
  ├── Agent Runs
  └── Tool Calls
```

---

# 40. Project 数据隔离

LOOP 的核心隔离边界是：

```text
Project
```

一个 Project 下：

```text
多个 User
多个 Session
多个 Observation
多个 Memory
多个 Event
多个 Action
多个 Schedule
```

但是不同 Project 之间完全隔离。

例如：

```text
Project A
 ├── User A
 ├── User B
 └── Memory A

Project B
 ├── User A
 └── Memory B
```

即使 User A 同时参与两个项目：

```text
User A
 ├── Project A → Agent A
 └── Project B → Agent B
```

两个 Agent 的：

```text
State
Memory
Session
Observation
Action
```

都不能互相访问。

这也是为什么 Memory 必须至少以：

```text
project_id
```

作为隔离边界。

---

# 41. Agent Context 构建

每次 Agent Run 不应该把整个数据库全部塞给 PI。

应该动态构建 Context：

```text
Project
+
Current State
+
Recent Observations
+
Active Actions
+
Relevant Memory
+
Recent Decisions
+
Current Session
```

例如：

```text
Project：
验证蛋白 X 是否影响肿瘤细胞增殖

Current State：
实验验证阶段

Recent Observation：
第二组实验出现异常

Active Action：
检查实验条件

Relevant Memory：
此前第一组实验正常
```

然后交给：

```text
PI Agent
```

进行 Think。

---

# 42. Agent Runtime 的完整流程

### 用户输入

```text
用户：
第二组实验做完了，数据还是异常。
```

### Step 1：Observation

```text
Observation
第二组实验完成，数据异常。
```

### Step 2：更新上下文

加载：

```text
Project
State
Memory
Active Actions
```

### Step 3：Think

PI Agent 分析：

```text
第二组实验已经连续异常。
```

### Step 4：Judgment

```text
当前实验结果存在持续异常，
需要进一步确认实验条件。
```

### Step 5：Recommendation

```text
建议检查实验条件，并重新验证第二组实验。
```

### Step 6：Human Confirm

用户确认。

### Step 7：Action

```text
检查实验条件
```

### Step 8：Execute

执行 Action。

### Step 9：Result

```text
发现第二组实验使用了不同批次试剂。
```

### Step 10：Observation

```text
新的 Observation：
第二组实验使用不同批次试剂。
```

### Step 11：State Update

Agent 更新：

```text
Open Issue：
实验异常可能与试剂批次有关。
```

### Step 12：Loop

再次 Think。

这就是 LOOP。

---

# 43. UI 设计

LOOP 作为独立 Agent Runtime，同时提供自己的 UI。

核心页面不需要复杂。

## 43.1 Project 列表

```text
我的项目

┌─────────────────────────────┐
│ AI 科研项目管理系统          │
│ 当前：实验验证               │
│ 风险：2                      │
│ Action：5                    │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 新产品                       │
│ 当前：产品验证               │
│ Action：3                    │
└─────────────────────────────┘
```

这里实际上展示的是：

> **我的 Project Agents**

---

# 44. Project / Agent 页面

项目详情页是 LOOP 最核心的页面。

建议：

```text
┌───────────────────────────────────────────┐
│ AI 科研项目管理系统                        │
│                                           │
│ 目标                                      │
│ 完成科研项目管理 Agent MVP                 │
├───────────────────────────────────────────┤
│ 当前状态                                  │
│ 当前处于 MVP 开发阶段                      │
│                                           │
│ 当前问题                                  │
│ • Memory 方案尚未确定                      │
│ • Agent Runtime 尚未完成                   │
├───────────────────────────────────────────┤
│ 当前行动                                  │
│ • 完成数据库设计                            │
│ • 实现 Agent Runtime                       │
├───────────────────────────────────────────┤
│ AI 建议                                   │
│ 建议优先完成 Runtime，再实现长期 Memory。  │
└───────────────────────────────────────────┘
```

核心不是任务列表。

而是：

> **这个项目现在是什么情况，以及下一步应该做什么。**

---

# 45. Chat

Chat 是用户与 Project Agent 直接沟通的入口。

例如：

```text
User：

我们今天决定暂时放弃原来的方案。

Agent：

收到。

我理解这意味着项目路线发生变化。

目前原方案已经不再作为当前执行路线。

我建议确认两个问题：
1. 新路线是什么？
2. 原方案是否需要保留为历史方案？
```

用户与 Agent 的关系是：

> **人与项目沟通。**

而不是：

> 人与一个宠物型 AI 助手聊天。

---

# 46. 项目时间线

时间线用于展示：

```text
Observation
Event
Decision
Action
Result
```

例如：

```text
09-30
实验完成

09-30
发现第二组数据异常

10-01
团队决定重新实验

10-02
实验完成

10-02
数据恢复正常
```

这样用户可以看到：

> **项目是如何一步一步演化到当前状态的。**

---

# 47. AI 主动运行

LOOP 与普通 Chat Agent 的重要区别：

普通 Chat：

```text
User
 ↓
AI
```

LOOP：

```text
User
 ↓
AI

或者：

Schedule
 ↓
AI

或者：

Event
 ↓
AI

或者：

External System
 ↓
AI
```

因此即使用户不说话：

```text
每天 09:00
 ↓
Agent Wake
 ↓
检查项目
 ↓
发现风险
 ↓
发送 Recommendation
```

这才是长期 Agent。

---

# 48. API 设计

业务系统可以直接调用 LOOP Runtime。

### 创建项目

```http
POST /projects
```

### 获取项目

```http
GET /projects/:project_id
```

### 添加成员

```http
POST /projects/:project_id/members
```

### 创建 Session

```http
POST /projects/:project_id/sessions
```

### 发送消息

```http
POST /sessions/:session_id/messages
```

### 提交 Observation

```http
POST /projects/:project_id/observations
```

### 创建 Action

```http
POST /projects/:project_id/actions
```

### 创建 Schedule

```http
POST /projects/:project_id/schedules
```

### 获取 State

```http
GET /projects/:project_id/state
```

### 获取 Memory

```http
GET /projects/:project_id/memories
```

### 获取 Agent Run

```http
GET /projects/:project_id/runs
```

业务系统不需要直接调用 PI。

统一：

```text
Business System
      ↓
LOOP API
      ↓
LOOP Runtime
      ↓
PI Agent
```

---

# 49. MVP 范围

第一版不应该把所有能力全部实现。

核心闭环只需要：

```text
Project
+
Members
+
Chat
+
Observation
+
State
+
Action
+
Execution
+
Agent Run
+
Schedule
```

其中 Memory 第一版可以非常简单。

第一版 Context：

```text
Project
+
Current State
+
Recent Observation
+
Active Action
+
Recent Result
```

已经足够验证 Agent Loop。

长期 Memory 可以后续逐渐加入。

---

# 50. 第一版不做什么

暂时不要做：

* 多 Agent 协作
* Agent Marketplace
* 复杂知识库
* 复杂权限系统
* 多层级 Task
* 甘特图
* KPI
* 工时
* 复杂报表
* 自动修改所有项目状态
* 复杂 Memory Graph
* 自定义 Agent Personality
* 多 Agent Planner

因为这些都不是 LOOP 最核心的问题。

第一版只需要证明：

> **一个 Project 能不能真正作为一个长期 Agent 持续运行。**

---

# 51. LOOP 的最小技术闭环

最终 MVP 可以压缩成：

```text
Project
   ↓
Observation
   ↓
Load State
   ↓
Load Context
   ↓
PI Agent
   ↓
Judgment
   ↓
Recommendation / Action
   ↓
Execute
   ↓
Result
   ↓
Observation
   ↓
Update State
   ↓
Wait
   ↓
Next Trigger
```

其中：

```text
User
Schedule
Event
API
```

都可以成为 Next Trigger。

---

# 52. 最终系统架构

```text
                         LOOP
                          │
              ┌───────────┴───────────┐
              │                       │
           Web UI                  API / SDK
              │                       │
              └───────────┬───────────┘
                          ↓
                   LOOP Runtime
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
       ↓                  ↓                  ↓
    Project            Scheduler          Sessions
       │
       ├── State
       ├── Memory
       ├── Observation
       ├── Event
       ├── Action
       ├── Execution
       ├── Recommendation
       └── Agent Run
                          │
                          ↓
                    Agent Engine
                          │
                    ┌─────┴─────┐
                    ↓           ↓
                 PI Agent    Other Engine
```

---

# 53. 最终产品定位

LOOP 不是：

> AI Todo List

不是：

> AI 项目管理工具

也不是：

> 一个带聊天功能的项目管理系统。

更准确的定义是：

> **LOOP 是一个让项目成为长期运行 Agent 的系统。**

一个项目拥有：

```text
目标
状态
记忆
感知
思考
行动
反馈
```

多个项目成员共同向这个 Agent 推进。

因此：

```text
                 Project Agent
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
      User A        User B        User C
        │             │             │
        └─────────────┼─────────────┘
                      ↓
                  Project State
                      ↓
                    Think
                      ↓
                    Action
                      ↓
                    Result
                      ↓
                    Loop
```

最终可以把 LOOP 的核心抽象为：

> **Project = Agent**

以及：

> **Agent = Goal + State + Memory + Observe + Think + Act + Feedback**

而 LOOP Runtime 的任务，就是让这个 Project Agent **长期存在、持续运行，并在现实变化之后不断重新判断下一步。**

**One Project = One Agent。**
