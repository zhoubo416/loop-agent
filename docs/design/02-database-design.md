# 数据库设计

> 版本：MVP  
> 所属系统：LOOP Agent Runtime  
> 核心原则：**One Project = One Agent**

---

# 1. 数据库设计目标

LOOP 的数据库不是传统项目管理系统的数据库。

核心目标是保存一个 Project Agent 长期运行所需要的：

- Project 身份
- Project 成员
- 当前 State
- State 历史
- Observation
- Event
- Action
- Execution
- Memory
- Session
- Recommendation
- Schedule
- Agent Run
- Tool Call

数据库需要支持 Agent 持续经历：

```text
Observation
    ↓
Think
    ↓
Recommendation / Action
    ↓
Execution
    ↓
Result
    ↓
Observation
    ↓
Next Agent Run
```

---

# 2. 核心设计原则

## 2.1 Project = Agent

MVP 不建立独立的 `agents` 表。

```text
Project
  =
Agent
```

`projects.id` 同时作为：

- Project ID
- Agent Business ID
- Project 数据隔离边界

如果未来一个 Project 内需要多个专业 Agent，再引入 `agents` 表。

---

## 2.2 Project 是数据隔离边界

除 `users` 和 `project_users` 外，所有业务数据都必须能够追溯到：

```text
project_id
```

例如：

```text
Project A
├── State A
├── Memory A
├── Session A
├── Observation A
├── Action A
└── Agent Run A

Project B
├── State B
├── Memory B
├── Session B
├── Observation B
├── Action B
└── Agent Run B
```

同一个用户参与多个 Project 时，Project 之间的数据完全隔离。

---

## 2.3 当前状态与历史状态分离

`agent_states` 保存当前 State。

`agent_state_versions` 保存历史 State。

```text
agent_states
    ↓
Current State

agent_state_versions
    ↓
State v1
State v2
State v3
...
```

这样可以支持：

- 状态回溯
- Agent Debug
- Timeline
- 审计
- 状态变更分析
- 并发控制

---

## 2.4 Session 不等于 Memory

Session 保存交互过程：

```text
用户说了什么
Agent 回复了什么
```

Memory 保存经过提炼、未来仍然有价值的信息。

因此：

```text
Session Message ≠ Memory
```

---

## 2.5 Observation 不等于 Event

Observation 是进入系统的新信息。

Event 是 Agent 从 Observation 中识别出的事实。

例如：

```text
Observation
“第二组实验失败了”

        ↓ Think

Event
“第二组实验失败”
```

---

## 2.6 Action 不等于 Execution

Action：

> 应该做什么。

Execution：

> 实际执行了一次什么。

一个 Action 可以有多次 Execution。

```text
Action
检查实验条件
   │
   ├── Execution #1 → Failed
   └── Execution #2 → Success
```

---

# 3. 核心实体关系

```text
                         ┌──────────────┐
                         │    users     │
                         └──────┬───────┘
                                │
                                │ N:M
                                ↓
                         project_users
                                │
                                ↓
┌─────────────────────────────────────────────────────┐
│                     projects                         │
│                  Project = Agent                     │
└─────────────────────────────────────────────────────┘
       │
       ├────────────── 1:1 ────────── agent_states
       │                                  │
       │                                  └──< agent_state_versions
       │
       ├────────────── 1:N ────────── sessions
       │                                  │
       │                                  └──< session_messages
       │
       ├────────────── 1:N ────────── observations
       │                                  │
       │                                  └──< events
       │                                         │
       │                                         └──< actions
       │                                                │
       │                                                └──< executions
       │
       ├────────────── 1:N ────────── memories
       │
       ├────────────── 1:N ────────── recommendations
       │
       ├────────────── 1:N ────────── schedules
       │
       └────────────── 1:N ────────── agent_runs
                                              │
                                              └──< tool_calls
```

核心关系：

```text
Project 1 : N Observation
Observation 1 : N Event
Event 1 : N Action
Action 1 : N Execution

Project 1 : N Memory
Project 1 : N Recommendation
Project 1 : N Schedule
Project 1 : N AgentRun

Project 1 : 1 CurrentState
CurrentState 1 : N StateVersion

Project N : M User
```

---

# 4. 数据库技术建议

MVP 推荐：

- PostgreSQL
- UUID
- JSONB
- `timestamptz`
- Row Level Security（如果使用 Supabase）
- 数据库事务
- 乐观锁

时间统一使用：

```text
timestamptz
```

统一保存 UTC。

前端根据用户时区展示。

---

# 5. users

## 5.1 作用

系统用户。

用户本身不是 Agent 的拥有者。

用户通过 `project_users` 参与 Project。

## 5.2 表结构

```sql
users
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| name | varchar(100) | NO | - | 用户名称 |
| email | varchar(255) | YES | - | 邮箱 |
| avatar | text | YES | - | 头像 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

约束：

```text
PK(id)
UNIQUE(email)
```

---

# 6. projects

## 6.1 作用

Project 是 LOOP 的核心实体，也是 Agent 的业务身份。

Project 保存 Agent 的：

- 长期目标
- 描述
- 成功标准
- 约束
- 生命周期状态

## 6.2 表结构

```sql
projects
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK / Agent ID |
| name | varchar(200) | NO | - | Project 名称 |
| objective | text | NO | - | Project 长期目标 |
| description | text | YES | - | Project 描述 |
| success_criteria | jsonb | NO | '[]' | 成功标准 |
| constraints | jsonb | NO | '{}' | 约束 |
| status | varchar(30) | NO | 'created' | 生命周期状态 |
| current_stage | varchar(200) | YES | - | 当前阶段 |
| created_by | uuid | NO | - | 创建者 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |
| archived_at | timestamptz | YES | - | 归档时间 |

### status

```text
created
active
paused
completed
archived
```

### 约束

```text
PK(id)

FK(created_by)
→ users.id
```

### 索引

```text
INDEX(status)
INDEX(created_by)
INDEX(updated_at)
```

---

# 7. project_users

## 7.1 作用

建立 Project 与 User 的多对多关系。

```text
User N : M Project
```

## 7.2 表结构

```sql
project_users
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| user_id | uuid | NO | - | User |
| role | varchar(30) | NO | 'member' | 成员角色 |
| joined_at | timestamptz | NO | now() | 加入时间 |
| created_at | timestamptz | NO | now() | 创建时间 |

### role

```text
owner
admin
member
viewer
```

### 约束

```text
UNIQUE(project_id, user_id)

FK(project_id)
→ projects.id

FK(user_id)
→ users.id
```

### 索引

```text
INDEX(project_id)
INDEX(user_id)
```

---

# 8. agent_states

## 8.1 作用

保存 Project Agent 当前对 Project 的结构化理解。

State 是：

> Agent 当前认为 Project 处于什么状态。

不是历史记录。

## 8.2 表结构

```sql
agent_states
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| current_stage | varchar(200) | YES | - | 当前阶段 |
| current_situation | text | YES | - | 当前情况 |
| open_issues | jsonb | NO | '[]' | 开放问题 |
| active_actions | jsonb | NO | '[]' | 当前行动摘要 |
| risks | jsonb | NO | '[]' | 风险 |
| unknowns | jsonb | NO | '[]' | 未知项 |
| context | jsonb | NO | '{}' | 其他结构化上下文 |
| version | integer | NO | 1 | 乐观锁版本 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

### 约束

```text
UNIQUE(project_id)
```

因此：

```text
Project 1 : 1 Current State
```

### 并发控制

更新时使用：

```sql
UPDATE agent_states
SET
    current_situation = ...,
    version = version + 1,
    updated_at = now()
WHERE project_id = ?
  AND version = ?;
```

如果影响行数为 0：

```text
State Conflict
```

Runtime 必须重新读取 State。

---

# 9. agent_state_versions

## 9.1 作用

保存 State 的历史版本。

## 9.2 表结构

```sql
agent_state_versions
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| state_id | uuid | NO | - | 当前 State ID |
| version | integer | NO | - | State 版本 |
| state | jsonb | NO | - | 完整 State |
| changed_by_type | varchar(30) | NO | - | user/agent/system |
| changed_by_id | uuid | YES | - | 操作者/Run |
| agent_run_id | uuid | YES | - | 来源 Agent Run |
| created_at | timestamptz | NO | now() | 创建时间 |

### 约束

```text
UNIQUE(project_id, version)

FK(project_id)
→ projects.id

FK(state_id)
→ agent_states.id

FK(agent_run_id)
→ agent_runs.id
```

注意：

`agent_run_id` 与 `agent_runs` 存在循环依赖时，可以采用：

1. 先创建 Agent Run
2. 再写 State Version

---

# 10. sessions

## 10.1 作用

Session 表示一次短期交互或执行上下文。

例如：

- Chat
- Meeting
- Schedule
- API
- System

## 10.2 表结构

```sql
sessions
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| user_id | uuid | YES | - | 发起用户 |
| type | varchar(30) | NO | 'chat' | Session 类型 |
| status | varchar(30) | NO | 'active' | 状态 |
| started_at | timestamptz | NO | now() | 开始时间 |
| ended_at | timestamptz | YES | - | 结束时间 |
| created_at | timestamptz | NO | now() | 创建时间 |

### type

```text
chat
meeting
schedule
event
api
system
```

### status

```text
active
completed
cancelled
```

---

# 11. session_messages

## 11.1 作用

保存 Session 中的原始交互内容。

## 11.2 表结构

```sql
session_messages
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| session_id | uuid | NO | - | Session |
| role | varchar(30) | NO | - | 消息角色 |
| content | text | NO | - | 内容 |
| metadata | jsonb | NO | '{}' | 元信息 |
| created_at | timestamptz | NO | now() | 创建时间 |

### role

```text
user
assistant
system
tool
```

### 索引

```text
INDEX(session_id, created_at)
```

---

# 12. observations

## 12.1 作用

Observation 是进入 Agent 系统的新信息。

它回答：

> “发生了什么？”

来源可以是：

- 用户输入
- Meeting
- Document
- Action Result
- External Event
- Schedule
- API
- System

## 12.2 表结构

```sql
observations
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| session_id | uuid | YES | - | Session |
| user_id | uuid | YES | - | 来源用户 |
| type | varchar(40) | NO | - | Observation 类型 |
| content | text | NO | - | 内容 |
| source | varchar(100) | YES | - | 来源系统 |
| metadata | jsonb | NO | '{}' | 附加信息 |
| created_at | timestamptz | NO | now() | 创建时间 |

### type

```text
user_input
conversation
meeting
document
action_result
external_event
schedule
api
system
```

`conversation` 由 Chat 的研究讨论产生：AI 回复用户问题后，把这段会话的全部问答记录（“我：… / 智能体：…”逐条）作为一条观察交给思考阶段，思考据此判断项目是否需要变化。

### 索引

```text
INDEX(project_id, created_at)
INDEX(project_id, type, created_at)
```

---

# 13. events

## 13.1 作用

Event 是从 Observation 中识别出来的事实。

一个 Observation 可以产生多个 Event。

## 13.2 表结构

```sql
events
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| observation_id | uuid | NO | - | 来源 Observation |
| agent_run_id | uuid | YES | - | 产生 Event 的 Run |
| type | varchar(50) | NO | - | Event 类型 |
| title | varchar(300) | NO | - | 标题 |
| content | text | NO | - | 内容 |
| status | varchar(30) | NO | 'open' | 状态 |
| occurred_at | timestamptz | NO | now() | 实际发生时间 |
| created_at | timestamptz | NO | now() | 创建时间 |

### status

MVP：

```text
open
resolved
cancelled
```

---

# 14. actions

## 14.1 作用

Action 表示需要完成的一项行动。

Action 来源可以是：

- Agent
- User
- Event
- Recommendation

## 14.2 表结构

```sql
actions
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| event_id | uuid | YES | - | 来源 Event |
| agent_run_id | uuid | YES | - | 创建 Action 的 Run |
| title | varchar(300) | NO | - | Action 标题 |
| description | text | YES | - | 描述 |
| executor_type | varchar(30) | NO | 'human' | 执行者类型 |
| assignee_id | uuid | YES | - | 指定用户 |
| status | varchar(30) | NO | 'pending' | 状态 |
| priority | varchar(20) | NO | 'medium' | 优先级 |
| due_at | timestamptz | YES | - | 截止时间 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |
| completed_at | timestamptz | YES | - | 完成时间 |

### executor_type

```text
human
agent
system
```

### status

```text
proposed
pending
running
completed
failed
cancelled
```

`proposed` 是 Agent 产出、等待用户确认的状态，用户确认后进入 `pending`，拒绝后进入 `cancelled`。它把“Agent 提议”和“真正要执行的行动”分开，落实第 25 节的人工确认。

### priority

```text
low
medium
high
critical
```

### 索引

```text
INDEX(project_id, status)
INDEX(project_id, due_at)
INDEX(assignee_id, status)
INDEX(agent_run_id)
```

---

# 15. executions

## 15.1 作用

Execution 表示 Action 的一次实际执行尝试。

## 15.2 表结构

```sql
executions
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| action_id | uuid | NO | - | Action |
| executor_type | varchar(30) | NO | - | 执行者类型 |
| executor_id | uuid | YES | - | 执行者 |
| input | jsonb | NO | '{}' | 输入 |
| output | jsonb | NO | '{}' | 输出 |
| status | varchar(30) | NO | 'running' | 执行状态 |
| error | jsonb | YES | - | 错误 |
| idempotency_key | varchar(255) | YES | - | 幂等键 |
| started_at | timestamptz | NO | now() | 开始时间 |
| completed_at | timestamptz | YES | - | 完成时间 |

### status

```text
running
completed
failed
cancelled
```

### 约束

```text
UNIQUE(idempotency_key)
```

如果 idempotency_key 不为空。

---

# 16. memories

## 16.1 作用

Memory 是从历史信息中提炼出的、未来仍可能有价值的长期信息。

Memory 不是：

- Session Message
- Observation 原文
- 全部历史数据

## 16.2 表结构

```sql
memories
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| agent_run_id | uuid | YES | - | 产生 Memory 的 Run |
| type | varchar(30) | NO | - | Memory 类型 |
| content | text | NO | - | Memory 内容 |
| source_type | varchar(50) | YES | - | 来源类型 |
| source_id | uuid | YES | - | 来源 ID |
| confidence | numeric(4,3) | YES | - | 可信度 |
| status | varchar(30) | NO | 'active' | 状态 |
| superseded_by | uuid | YES | - | 被哪条 Memory 替代 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

### type

```text
event
decision
action
conclusion
context
```

### status

```text
active
superseded
invalid
archived
```

### 生命周期

```text
create
 ↓
update / merge
 ↓
supersede / invalidate
 ↓
archive
```

MVP 不要求复杂 Memory 自动整理。

---

# 17. recommendations

## 17.1 作用

Recommendation 表示 Agent 提出的判断或下一步建议。

Recommendation 与 Action 不完全相同。

例如：

```text
Recommendation：
建议先确认实验异常原因。

Action：
检查实验条件。
```

## 17.2 表结构

```sql
recommendations
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| agent_run_id | uuid | YES | - | 来源 Run |
| judgment | text | YES | - | 判断 |
| type | varchar(50) | NO | - | Recommendation 类型 |
| content | text | NO | - | 建议内容 |
| priority | varchar(20) | NO | 'medium' | 优先级 |
| requires_confirmation | boolean | NO | true | 是否需要确认 |
| status | varchar(30) | NO | 'pending' | 状态 |
| created_at | timestamptz | NO | now() | 创建时间 |
| resolved_at | timestamptz | YES | - | 处理时间 |

### status

```text
pending
accepted
rejected
expired
executed
```

---

# 18. schedules

## 18.1 作用

Schedule 负责决定 Agent 什么时候被唤醒。

Schedule 不负责 Think。

```text
Schedule
→ Trigger
→ Agent Run
```

## 18.2 表结构

```sql
schedules
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| type | varchar(30) | NO | - | Schedule 类型 |
| expression | varchar(255) | YES | - | cron/interval 表达式 |
| payload | jsonb | NO | '{}' | Trigger 参数 |
| status | varchar(30) | NO | 'active' | 状态 |
| next_run_at | timestamptz | YES | - | 下一次执行 |
| last_run_at | timestamptz | YES | - | 上次执行 |
| created_at | timestamptz | NO | now() | 创建时间 |
| updated_at | timestamptz | NO | now() | 更新时间 |

### type

```text
once
interval
cron
event
manual
```

### status

```text
active
paused
completed
cancelled
```

### 索引

```text
INDEX(status, next_run_at)
INDEX(project_id, status)
```

---

# 19. agent_runs

## 19.1 作用

Agent Run 表示一次 Agent Runtime 的完整运行。

它是 LOOP 中最重要的运行记录之一。

## 19.2 表结构

```sql
agent_runs
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| session_id | uuid | YES | - | Session |
| trigger_type | varchar(30) | NO | - | Trigger 类型 |
| trigger_id | uuid | YES | - | Trigger 来源 |
| input_context | jsonb | NO | '{}' | 实际发送给 Agent 的上下文 |
| output | jsonb | YES | - | Agent 输出 |
| status | varchar(30) | NO | 'pending' | Run 状态 |
| error | jsonb | YES | - | 错误信息 |
| started_at | timestamptz | YES | - | 开始时间 |
| completed_at | timestamptz | YES | - | 完成时间 |
| created_at | timestamptz | NO | now() | 创建时间 |

### trigger_type

```text
user
observation
schedule
event
api
system
```

### status

```text
pending
running
completed
failed
cancelled
```

### 索引

```text
INDEX(project_id, created_at)
INDEX(project_id, status)
INDEX(project_id, started_at)
```

---

# 20. tool_calls

## 20.1 作用

记录 Agent Run 调用工具的情况。

## 20.2 表结构

```sql
tool_calls
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| agent_run_id | uuid | NO | - | Agent Run |
| tool_name | varchar(200) | NO | - | 工具名称 |
| input | jsonb | NO | '{}' | 输入 |
| output | jsonb | YES | - | 输出 |
| status | varchar(30) | NO | 'running' | 状态 |
| error | jsonb | YES | - | 错误 |
| started_at | timestamptz | NO | now() | 开始时间 |
| completed_at | timestamptz | YES | - | 完成时间 |

### status

```text
running
completed
failed
cancelled
```

### 索引

```text
INDEX(agent_run_id)
```

---

# 21. Entity 来源关系

为了回答：

> “这条数据是怎么产生的？”

核心 Agent 产物增加：

```text
agent_run_id
```

关系：

```text
Agent Run
 ├── Recommendation
 ├── Action
 ├── Event
 ├── Memory
 └── State Version
```

因此可以追踪：

```text
Agent Run #123
    ↓
发现异常
    ↓
Recommendation #10
    ↓
Action #20
    ↓
Execution #31
    ↓
Observation #50
```

---

# 22. State / Memory / Observation 数据边界

这是数据库必须遵守的核心规则。

| 对象 | 回答的问题 |
|---|---|
| Observation | 发生了什么 / 新信息是什么 |
| Event | 识别出了什么事实 |
| State | 现在 Project 处于什么状态 |
| Memory | 过去什么信息值得长期保留 |
| Action | 接下来应该做什么 |
| Execution | 实际执行了一次什么 |
| Recommendation | Agent 建议做什么 |
| Session | 这次交互发生了什么 |
| Agent Run | Agent 这一次运行做了什么 |

例如：

```text
用户输入：
“第二组实验失败了”

Observation
↓
Event：第二组实验失败
↓
Agent Think
↓
State：当前实验存在异常
↓
Recommendation：先确认异常原因
↓
Action：检查实验条件
↓
Execution：张三检查实验条件
↓
Result：发现温度控制异常
↓
Observation
↓
Next Agent Run
```

---

# 23. Project 数据隔离

## 23.1 原则

所有 Project 级数据必须满足：

```text
record.project_id = authorized_project_id
```

## 23.2 RLS

如果使用 Supabase/PostgreSQL，推荐开启 RLS。

基本规则：

```text
用户可以访问 Project 数据
⇔
用户存在 project_users(project_id, user_id)
```

例如：

```sql
EXISTS (
    SELECT 1
    FROM project_users pu
    WHERE pu.project_id = projects.id
      AND pu.user_id = auth.uid()
)
```

对于 Observation、Memory、Action 等表：

```text
record.project_id
→ project_users
→ auth.uid()
```

## 23.3 不能只依赖前端

错误方式：

```text
GET /projects/:id/memories
```

然后相信前端传来的 `project_id`。

必须在数据库或后端服务再次验证权限。

---

# 24. Foreign Key 删除策略

推荐：

## Project

不允许直接级联删除全部历史数据。

使用：

```text
archived
```

必要时增加：

```text
deleted_at
```

## Project User

可以：

```text
ON DELETE CASCADE
```

## Session

可以级联删除 Message，但 MVP 更建议保留历史。

## Observation / Event / Action / Execution

原则上不级联物理删除。

因为这些数据构成 Agent 的历史。

## Memory

采用：

```text
status = archived
```

而不是物理删除。

---

# 25. Index 设计原则

不要给每个字段都建索引。

重点索引：

```text
project_id
project_id + created_at
project_id + status
project_id + type
assignee_id + status
schedule status + next_run_at
agent_run_id
session_id + created_at
```

原因：

LOOP 最常见查询是：

```text
某 Project 最近发生了什么？
某 Project 当前有哪些 Action？
某 Project 最近有哪些 Agent Run？
某 Project 有哪些 Active Memory？
哪些 Schedule 到时间了？
某 Session 最近的消息？
```

---

# 26. JSONB 设计

MVP 使用 JSONB 保存动态结构。

适合：

```text
success_criteria
constraints
state.open_issues
state.risks
state.unknowns
observation.metadata
execution.input
execution.output
agent_run.input_context
agent_run.output
schedule.payload
tool_call.input
tool_call.output
```

不适合：

```text
需要频繁 JOIN
需要严格 FK
需要高频筛选
需要复杂统计
```

例如：

```json
{
  "open_issues": [
    {
      "title": "第二组实验异常",
      "priority": "high"
    }
  ]
}
```

如果未来发现某类数据需要独立管理，再拆表。

---

# 27. Transaction 边界

## 27.1 创建 Observation

建议：

```text
BEGIN

Create Observation
Create Agent Trigger / enqueue

COMMIT
```

不能出现：

```text
Observation 已创建
但 Trigger 丢失
```

## 27.2 State Update

```text
BEGIN

读取 State version
验证 version
写 State
写 State Version

COMMIT
```

## 27.3 Action Completion

```text
BEGIN

Create Execution
Update Action
Create Observation

COMMIT
```

如果 Execution 成功但 Observation 没有产生，Agent Loop 会断掉。

---

# 28. 并发控制

核心原则：

> 同一个 Project 同一时间只允许一个 Agent Run 修改 Project State。

推荐两层控制：

### 第一层：Runtime Lock

```text
project_id → distributed lock
```

### 第二层：State Version

```text
version = 12

Agent A
→ version 12
→ update
→ version 13

Agent B
→ version 12
→ update failed
```

第二层用于防止 Runtime Lock 失效或多个 Worker 意外并发。

---

# 29. Agent Run 幂等

Trigger 必须拥有唯一标识。

例如：

```text
trigger_id = observation_id
```

同一个 Observation 不应该产生多个有效 Run。

对于 Execution：

```text
idempotency_key
```

防止 Worker 重启导致：

```text
同一个 Action 被执行两次
```

---

# 30. Schedule 幂等

Schedule Worker 可能因为：

- Worker 重启
- 网络超时
- 多 Worker
- Retry

重复扫描。

因此：

```text
Schedule
→ Trigger
```

必须可以幂等。

建议生成：

```text
schedule_id + scheduled_at
```

作为一次 Schedule Trigger 的唯一标识。

---

# 31. 数据生命周期

典型 Project 数据生命周期：

```text
Project Created
      ↓
Active
      ↓
大量 Observation
      ↓
Agent Run
      ↓
State / Memory / Action
      ↓
Execution
      ↓
Result
      ↓
新的 Observation
      ↓
循环
      ↓
Completed
      ↓
Archived
```

Project Archived 后：

- 不再接受普通 Agent Trigger
- 不再执行 Schedule
- 历史数据保留

---

# 32. MVP 不建立的表

以下暂不建立：

```text
agents
goals
agent_contexts
workflows
workflow_steps
memory_embeddings
memory_clusters
agent_profiles
task_templates
agent_plans
```

原因：

当前 LOOP 的核心模型已经可以由：

```text
Project
State
Memory
Observation
Event
Action
Execution
Session
Recommendation
Schedule
AgentRun
```

表达。

不要为了“Agent 系统看起来完整”而提前增加抽象层。

---

# 33. 推荐 Migration 顺序

建议按照依赖关系：

```text
1. users
      ↓
2. projects
      ↓
3. project_users
      ↓
4. agent_states
      ↓
5. sessions
      ↓
6. session_messages
      ↓
7. observations
      ↓
8. agent_runs
      ↓
9. events
      ↓
10. actions
      ↓
11. executions
      ↓
12. recommendations
      ↓
13. memories
      ↓
14. schedules
      ↓
15. tool_calls
      ↓
16. agent_state_versions
```

如果数据库 FK 需要提前引用 `agent_runs`，可以调整：

```text
agent_runs
```

提前创建。

---

# 34. MVP 最终数据模型

最终核心模型：

```text
                         User
                          │
                          │ N:M
                          ↓
                       Project
                    = Agent Identity
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
       State           Memory             Session
        │                                    │
  State History                       Session Message
        │
        │
        ↓
   Observation
        │
        ↓
      Event
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
   Observation
        │
        └────────────→ Agent Run
                           │
                 ┌─────────┼─────────┐
                 ↓         ↓         ↓
           Recommendation Action   Memory
```

---

# 35. 数据库设计与 Runtime 的边界

数据库负责：

> 保存事实、状态和运行记录。

Runtime 负责：

> 决定 Agent 下一步怎么运行。

因此数据库不负责：

- Think
- 判断下一步
- 调用 PI
- 生成 Recommendation
- 自动决定 Action

这些属于 Runtime。

数据库只保存 Runtime 的结果。

---

# 36. 数据库设计与前端的边界

前端不应该直接理解所有数据库表。

例如前端不需要知道：

```text
agent_state_versions
tool_calls
agent_runs
```

这些主要服务 Runtime 和 Debug。

前端主要消费：

```text
Project
Current State
Recommendation
Action
Timeline
Session
```

Timeline 可以由后端聚合：

```text
Observation
Event
Recommendation
Action
Execution
Agent Run
```

不要求数据库建立一个 `timeline` 表。

---

# 37. MVP 数据库验收标准

数据库完成后必须满足：

### Project

- 可以创建 Project
- Project 可以加入多个 User
- User 可以参与多个 Project

### Isolation

- User 只能访问自己参与的 Project
- Project A 数据不能进入 Project B

### Agent

- Project 可以拥有唯一 Current State
- State 有 version
- State 有历史版本

### Loop

可以完整保存：

```text
Observation
→ Event
→ Action
→ Execution
→ Result
→ Observation
```

### Runtime

可以追踪：

```text
Agent Run
→ Recommendation
→ Action
→ Memory
→ State Version
```

### Reliability

支持：

- 乐观锁
- Idempotency
- Schedule 去重
- Run 状态记录
- Execution 状态记录

### Lifecycle

支持：

```text
created
active
paused
completed
archived
```

---

# 38. 可靠性支撑表

除了第 5 到 20 节的业务表，Runtime 还需要三张表来落实第 28、29、30 节要求的并发控制和幂等。这三张表不承载业务语义，只保存“这件事已经发生过”的事实。

## 38.1 idempotency_keys

HTTP 层幂等。`POST /observations`、`POST /chat` 这类会触发 Agent Run 的接口，客户端可以带 `Idempotency-Key`。

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| scope | varchar(200) | NO | - | 幂等范围，例如 `observation:{project_id}` |
| key | varchar(255) | NO | - | 客户端提供的幂等键 |
| request_hash | varchar(64) | YES | - | 保留字段，用于区分同键不同请求 |
| response | jsonb | NO | '{}' | 首次请求的响应，重复请求直接回放 |
| status | varchar(30) | NO | 'completed' | in_progress / completed |
| created_at | timestamptz | NO | now() | 创建时间 |

```text
UNIQUE(scope, key)
```

请求进入时先抢占 `(scope, key)`：抢到就执行业务逻辑并把响应写回；没抢到就回放已有响应，或者返回 `IDEMPOTENCY_CONFLICT`。业务逻辑失败时删除这条记录，允许客户端重试。

## 38.2 schedule_occurrences

Schedule 幂等。唯一标识是 `schedule_id + scheduled_at`，也就是“计划执行时间”而不是“实际执行时间”。

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| schedule_id | uuid | NO | - | Schedule |
| scheduled_at | timestamptz | NO | - | 本次计划执行时间 |
| agent_run_id | uuid | YES | - | 产生的 Agent Run |
| observation_id | uuid | YES | - | 产生的 Observation |
| created_at | timestamptz | NO | now() | 创建时间 |

```text
UNIQUE(schedule_id, scheduled_at)

FK(schedule_id)
→ schedules.id
```

Worker 用 `INSERT ... ON CONFLICT DO NOTHING` 抢占执行窗口，抢到的实例才继续创建 Observation 和 Agent Run。Worker 重启、重复扫描、多实例同时扫描都不会让同一个窗口触发两次。

## 38.3 project_locks

Project 级运行锁，保证同一个 Project 同一时间只有一个 Agent Run 在修改 State。

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| project_id | uuid | NO | - | PK，Project |
| holder | varchar(200) | NO | - | 持有者标识，例如 worker-1234 |
| agent_run_id | uuid | YES | - | 持有锁的 Run |
| acquired_at | timestamptz | NO | now() | 获取时间 |
| expires_at | timestamptz | NO | - | 过期时间 |

```text
PK(project_id)
```

获取锁用 `INSERT ... ON CONFLICT (project_id) DO UPDATE ... WHERE project_locks.expires_at < now()`，只有在没有锁或锁已过期时才会成功。`expires_at` 让 Worker 崩溃后不会永久占着锁。

这一层是“减少冲突”，不是“保证正确”：State 的 `version` 乐观锁仍然是最终防线，即使锁失效，状态也不会被静默覆盖。

---

# 39. state_proposals

## 39.1 作用

Agent 提出的结构性 State 变更，在应用前先落在这里等待用户确认。它与 `agent_state_versions` 的分工是：后者记录“已经发生过的 State 历史”，前者记录“可能发生、还没发生的变更”。

## 39.2 表结构

```sql
state_proposals
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| agent_run_id | uuid | YES | - | 提出变更的 Agent Run |
| proposal | jsonb | NO | '{}' | 待确认的 State 变更 |
| status | varchar(20) | NO | 'pending' | 状态 |
| created_at | timestamptz | NO | now() | 创建时间 |
| resolved_at | timestamptz | YES | - | 处理时间 |

```text
status: pending / applied / rejected / expired
```

## 39.3 与 State 更新的分工

Agent 的 `state_proposal` 拆成两部分处理：

- `current_situation`、`context` 属于现状整理，直接应用（第 25 节的 Level 1 自动）。
- `current_stage`、`open_issues`、`risks`、`unknowns` 属于改变阶段或结构，先写进本表，用户 apply 后才写入 `agent_states` 并生成 `agent_state_versions`。

这样“LLM 只提议、用户确认后 Runtime 才落库”的原则，对 State 这条路径也成立了。

---

# 40. notifications

## 40.1 作用

通知围绕“Agent 认为值得用户知道的事”，而不是“有东西更新了”。来源是 Agent 的新建议、Risk Engine 的风险发现，以及 Project 完成的提醒。

## 40.2 表结构

```sql
notifications
```

| 字段 | 类型 | NULL | 默认值 | 说明 |
|---|---|---:|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | - | Project |
| type | varchar(30) | NO | - | recommendation / risk / completion / event / system |
| severity | varchar(20) | NO | 'info' | info / warning / critical |
| title | varchar(300) | NO | - | 标题 |
| content | text | NO | - | 内容 |
| source_type | varchar(30) | YES | - | 来源类型 |
| source_id | uuid | YES | - | 来源 ID |
| dedup_key | varchar(255) | YES | - | 去重键 |
| status | varchar(20) | NO | 'unread' | unread / read |
| created_at | timestamptz | NO | now() | 创建时间 |
| read_at | timestamptz | YES | - | 已读时间 |

```text
INDEX(project_id, status, created_at DESC)
INDEX(project_id, dedup_key)
```

`dedup_key` 让同一条判断不会反复生成通知，例如 `recommendation:{id}` 或 `risk:stale_action:{action_id}`。

---

# 41. 最终原则

LOOP 数据库设计遵循一句话：

> **数据库保存 Project Agent 的“经历、状态和记忆”，Runtime 决定 Agent “下一步做什么”。**

因此整个数据库最终围绕一个 Project 展开：

```text
Project
   ↓
What happened?
Observation
   ↓
What was recognized?
Event
   ↓
What should be done?
Action
   ↓
What actually happened?
Execution / Result
   ↓
What does Agent believe now?
State
   ↓
What should be remembered?
Memory
   ↓
What did Agent recommend?
Recommendation
   ↓
How did Agent run?
Agent Run
   ↓
When should Agent wake again?
Schedule
```

这就是 LOOP MVP 的完整数据基础。

---

## 修改历史

- 2026-10-12：`observations.type` 增加 `conversation`（0009），Chat 对话讨论的“问题 + 回复”作为一条观察触发思考。
- 2026-10-12：移除腾讯会议集成，删除 `user_integrations` 与 `action_meeting_syncs` 表及配套接口；会议 Action 的记录回归手工填写。
- 2026-10-05：新增第 38 节“可靠性支撑表”，把 `idempotency_keys`、`schedule_occurrences`、`project_locks` 纳入数据模型；这三张表分别是 HTTP 幂等、Schedule 去重和 Project 运行锁的落地方式。
- 2026-10-05：Action 状态增加 `proposed`，新增第 39 节 `state_proposals` 表，落实人工确认闸门：Agent 的结构性 State 变更与产出的 Action 都先待用户确认。
- 2026-10-05：新增第 40 节 `notifications` 表，支撑围绕 Agent 判断的通知。
- 2026-10-05：`users` 增加 `password_hash`，新增 `user_tokens` 表，支撑邮箱密码登录与令牌鉴权。
- 2026-10-05：`actions` 增加 `kind`（task / meeting / document），区分行动对应的工作类型，完成时按类型采集结构化结果。
- 2026-10-05：新增 `user_integrations` 与 `action_meeting_syncs`，支持会议 Action 按需同步腾讯会议 Token、纪要、参会人和逐字稿。
