# API 接口设计

## 1. 文档目的

本文定义 LOOP 对外 API，用于：

* Web 前端
* 移动端
* 第三方业务系统
* LOOP Runtime 内部服务

调用 LOOP Agent。

核心原则：

> API 操作的是 Project Agent，而不是传统项目管理中的任务树。

核心运行模型：

```text
Project
   ↓
Observation
   ↓
Agent Run
   ↓
Think
   ↓
Recommendation / Action / State
   ↓
Execution
   ↓
Result
   ↓
Observation
   ↓
Agent Run
```

---

# 2. API 基础约定

## 2.1 Base URL

```text
/api/v1
```

---

## 2.2 数据格式

请求和响应统一使用：

```http
Content-Type: application/json
```

---

## 2.3 ID

所有资源使用 UUID：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 2.4 时间

统一使用 ISO 8601 / UTC：

```text
2026-09-30T08:30:00Z
```

---

# 3. API 分类

第一版 API 分为：

```text
Authentication
Projects
Project Members
Agent / State
Sessions
Observations
Events
Actions
Executions
Recommendations
Schedules
Agent Runs
Timeline
```

其中最重要的是：

```text
Projects
Observations
Actions
Sessions
Agent Runs
```

---

# 4. Project API

## 4.1 创建 Project

```http
POST /api/v1/projects
```

### Request

```json
{
  "name": "X 抗肿瘤作用研究",
  "objective": "验证 X 是否具有抗肿瘤作用",
  "description": "研究 X 在动物实验中的抗肿瘤效果",
  "success_criteria": [
    "完成动物实验",
    "完成数据分析",
    "结果达到预设标准"
  ],
  "constraints": {
    "budget": 100000,
    "deadline": "2027-06-30"
  }
}
```

### Response

```json
{
  "id": "project-id",
  "name": "X 抗肿瘤作用研究",
  "objective": "验证 X 是否具有抗肿瘤作用",
  "status": "created",
  "created_at": "2026-09-30T08:30:00Z"
}
```

创建 Project 后：

```text
Project
 ↓
创建 agent_state
```

不创建独立 Agent。

---

# 5. 获取 Project 列表

```http
GET /api/v1/projects
```

### Query

```text
?page=1
&page_size=20
&status=active
```

### Response

```json
{
  "items": [
    {
      "id": "project-id",
      "name": "X 抗肿瘤作用研究",
      "objective": "验证 X 是否具有抗肿瘤作用",
      "status": "active",
      "current_stage": "动物实验",
      "updated_at": "2026-09-30T08:30:00Z"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```

---

# 6. 获取 Project

```http
GET /api/v1/projects/{project_id}
```

返回 Project 基本信息。

```json
{
  "id": "project-id",
  "name": "X 抗肿瘤作用研究",
  "objective": "验证 X 是否具有抗肿瘤作用",
  "description": "...",
  "success_criteria": [],
  "constraints": {},
  "status": "active",
  "current_stage": "动物实验",
  "created_at": "...",
  "updated_at": "..."
}
```

---

# 7. 更新 Project

```http
PATCH /api/v1/projects/{project_id}
```

允许修改：

```text
name
description
objective
success_criteria
constraints
```

对于重要字段：

```text
objective
success_criteria
```

建议采用：

```text
User Request
 ↓
Observation
 ↓
Agent 判断
 ↓
Recommendation
 ↓
User Confirmation
 ↓
Apply
```

而不是简单直接修改。

---

# 8. Project 状态 API

## 获取当前 State

```http
GET /api/v1/projects/{project_id}/state
```

### Response

```json
{
  "project_id": "project-id",
  "current_stage": "动物实验",
  "current_situation": "实验 A 已完成，实验 B 结果异常",
  "open_issues": [
    "实验 B 异常原因未知"
  ],
  "active_actions": [
    "分析实验 B 数据"
  ],
  "risks": [
    "实验 B 连续两次失败"
  ],
  "unknowns": [
    "异常是否由实验条件导致"
  ],
  "version": 12,
  "updated_at": "2026-09-30T08:30:00Z"
}
```

---

# 9. State 不提供普通 PUT

不建议：

```http
PUT /projects/{id}/state
```

让前端直接覆盖 State。

因为 State 是 Agent 当前认知的一部分。

正确方式：

```text
Observation
 ↓
Agent Run
 ↓
State Proposal
 ↓
确认
 ↓
Runtime Apply
```

必要时提供：

```http
POST /api/v1/projects/{project_id}/state/proposals/{proposal_id}/apply
```

---

# 10. Project Members

## 获取成员

```http
GET /api/v1/projects/{project_id}/members
```

---

## 添加成员

```http
POST /api/v1/projects/{project_id}/members
```

```json
{
  "user_id": "user-id",
  "role": "member"
}
```

角色：

```text
owner
admin
member
viewer
```

---

## 修改角色

```http
PATCH /api/v1/projects/{project_id}/members/{user_id}
```

```json
{
  "role": "admin"
}
```

---

## 删除成员

```http
DELETE /api/v1/projects/{project_id}/members/{user_id}
```

---

# 11. Session API

Session 是一次交互上下文。

例如：

```text
chat
meeting
schedule
event
api
system
```

---

## 创建 Session

```http
POST /api/v1/projects/{project_id}/sessions
```

```json
{
  "type": "chat"
}
```

---

## 获取 Session

```http
GET /api/v1/projects/{project_id}/sessions/{session_id}
```

---

## 获取 Session 消息

```http
GET /api/v1/projects/{project_id}/sessions/{session_id}/messages
```

---

# 12. Chat API

Chat 是用户与项目智能体的研究讨论入口，对话和思考分离。

不建议：

```http
POST /chat
```

直接调用 PI。

应该：

```text
用户提问
 ↓
对话回答(同步,基于项目背景)
 ↓
“问题 + 回复”组合为 conversation Observation
 ↓
Agent Run(异步思考)
 ↓
State 提案 / Event / Action 提议 / Recommendation
```

对话回复不等思考完成；思考结果由前端在 Chat 页右侧展示，确认操作复用 State 提案、Action 与 Recommendation 的现有接口。

---

## 发送消息

```http
POST /api/v1/projects/{project_id}/chat
```

### Request

```json
{
  "session_id": "session-id",
  "content": "第二轮实验为什么会出现异常？",
  "idempotency_key": "client-request-001",
  "document_id": "资料行动 ID(可选)"
}
```

### Response

响应是 SSE 流（`text/event-stream`），请求体不变。事件按顺序：

```text
session     { "session_id": "session-id" }
reasoning   { "text": "先看项目当前状态……" }
delta       { "text": "结合当前记录" }
delta       { "text": "，还不能确定原因……" }
done        { "session_id": "…", "observation_id": "…", "agent_run_id": "…", "replayed": false }
```

* `session` 是第一个事件，前端靠它确定这条消息落在哪一段会话；请求没带 `session_id` 时，会话在这时创建。
* `reasoning` 是模型自己的推理过程（推理型模型才有，排在正文之前，可以有多条），前端单独展示在回答上方，不算回复正文。它随回复一起存进这条消息的 `metadata.reasoning`，刷新页面后还能展开查看；只用于展示，既不进入交给思考的问答记录，也不会回传给模型。
* `delta` 是回复正文的一个片段，按顺序拼接就是完整回复。
* `done` 表示回复结束，此时消息、Observation 和思考 Run 都已经落库。

失败分两种情况：

* 一个字都没输出就失败：服务端返回普通的 JSON 错误响应（错误格式沿用第 38 节，状态码沿用第 39 节），这次请求没有留下任何消息，用户直接重发即可。
* 输出到一半才失败：流以 `error` 事件结束（`{"code": "…", "message": "…"}`）。已经输出的正文仍然留在会话里并标记为 `interrupted`（推理过程一并保存），这一轮不产生 Observation、不触发思考，用户重发即可；被中断的回复不进入之后交给思考的问答记录。

重复提交（第 40 节的幂等键）不重新调用 Engine：回放上次的结果，`session` 之后按顺序发 `reasoning`（如果有）和一个内容是完整回复的 `delta`，`done.replayed` 为 `true`。

回复完成后，服务端把这段会话的全部问答记录（“我：… / 智能体：…”逐条）提交为一条 `conversation` Observation 并创建思考 Run；思考坚持宁缺毋滥，没有新信息的讨论只产生判断，不产出事件、提案、行动或建议。

从资料页进入对话时，请求携带可选的 `document_id`（资料行动 ID）：服务端校验它属于本项目且 `kind=document`，把该资料的文档文本（截断到 `DOCUMENT_CONTEXT_MAX_CHARS`）作为对话上下文一并交给 Engine，并把 `document_id` 记进这条 user 消息的 metadata。资料上下文只影响对话回复，不改变“对话产生 conversation Observation”的思考链路。

---

## 会话的思考结果

```http
GET /api/v1/projects/{project_id}/sessions/{session_id}/runs
```

返回该会话最近几次思考 Run 及其产出：`judgment`、State 提案、新事件、行动和建议，供 Chat 页右侧面板展示并直接操作。

产出处理过之后仍然返回，并各自带上 `status`，由前端决定是给「应用 / 确认 / 接受」按钮，还是显示处理结果（`applied`、`cancelled`、`executed`、`rejected` 等）。这一栏要能完整回看每轮思考产出了什么、用户当时是怎么处理的，不能点完「应用」就把这条抹掉。同一轮里由「接受并生成行动」产生的行动也带着这条 Run 的 `agent_run_id`，所以会作为一条 `pending` 行动跟着出现在同一张卡片里。

`GET /sessions` 的每项额外携带 `preview`（首条 user 消息内容，前端截断作会话标题）与 `message_count`，按创建时间倒序返回（最新在前）；`POST /chat` 不带 `session_id` 即创建新会话，支持一个 Project 下的多段对话。

---

# 13. Agent Run API

Agent Run 是 Runtime 的核心资源。

## 获取 Run

```http
GET /api/v1/projects/{project_id}/runs/{run_id}
```

### Response

```json
{
  "id": "run-id",
  "project_id": "project-id",
  "trigger_type": "user",
  "trigger_id": "observation-id",
  "status": "completed",
  "started_at": "...",
  "completed_at": "...",
  "created_at": "..."
}
```

---

## 查询 Run

```http
GET /api/v1/projects/{project_id}/runs
```

Query：

```text
status=completed
trigger_type=user
page=1
page_size=20
```

---

## 手动触发 Agent

```http
POST /api/v1/projects/{project_id}/runs
```

Request：

```json
{
  "trigger_type": "manual"
}
```

通常只用于：

* 手动重新思考
* 调试
* 管理员操作

正常业务优先通过 Observation / Schedule / Event 触发。

---

# 14. Observation API

Observation 是 Agent 感知现实的统一入口。

## 创建 Observation

```http
POST /api/v1/projects/{project_id}/observations
```

### Request

```json
{
  "type": "user_input",
  "content": "实验 B 已经完成，但是结果比预期差很多。",
  "source": "web",
  "session_id": "session-id",
  "metadata": {}
}
```

### Response

```json
{
  "id": "observation-id",
  "project_id": "project-id",
  "type": "user_input",
  "created_at": "2026-09-30T08:30:00Z",
  "agent_run": {
    "id": "run-id",
    "status": "queued"
  }
}
```

---

# 15. Observation 类型

MVP 支持：

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

# 16. 为什么 Observation API 很重要

未来：

```text
Chat
Meeting
Document
External System
Schedule
```

都可以统一进入：

```text
Observation
```

例如：

### Chat

```text
POST /observations
type=user_input
```

### Meeting

```text
POST /observations
type=meeting
```

### 外部系统

```text
POST /observations
type=external_event
```

### 定时检查

```text
type=schedule
```

这样 Runtime 不需要针对每一种入口设计不同的 Agent Loop。

---

# 17. Event API

Event 是 Project 中已经发生的事实。

## 获取 Events

```http
GET /api/v1/projects/{project_id}/events
```

Query：

```text
status=open
type=experiment_completed
from=2026-09-01
to=2026-09-30
page=1
page_size=50
```

---

## 获取 Event

```http
GET /api/v1/projects/{project_id}/events/{event_id}
```

---

## 创建 Event

一般不建议前端直接创建 Event。

推荐：

```text
Observation
 ↓
Agent
 ↓
Event
```

但在明确的外部系统集成场景，可以提供：

```http
POST /api/v1/projects/{project_id}/events
```

Request：

```json
{
  "type": "experiment_completed",
  "title": "实验 B 完成",
  "content": "实验 B 已经完成。",
  "occurred_at": "2026-09-30T08:00:00Z"
}
```

创建 Event 后是否触发 Agent，由 Runtime 配置决定。

---

# 18. Action API

Action 是当前需要执行的事情。

## 获取当前 Action

```http
GET /api/v1/projects/{project_id}/actions
```

Query：

```text
status=pending
executor_type=human
priority=high
```

---

## 获取 Action

```http
GET /api/v1/projects/{project_id}/actions/{action_id}
```

---

## 创建 Action

```http
POST /api/v1/projects/{project_id}/actions
```

```json
{
  "title": "分析实验 B 数据",
  "description": "分析实验 B 的统计结果",
  "executor_type": "human",
  "assignee_id": "user-id",
  "priority": "high",
  "due_at": "2026-10-05T10:00:00Z"
}
```

但是业务上推荐：

```text
Agent → Action Proposal → User Confirm
```

而不是让前端随意创建大量 Action。

---

# 19. Action 状态

```text
pending
running
completed
failed
cancelled
```

状态变化：

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
```

---

# 20. Action 完成 API

```http
POST /api/v1/projects/{project_id}/actions/{action_id}/complete
```

Request：

```json
{
  "result": {
    "summary": "实验 B 数据分析完成",
    "output": {}
  }
}
```

Response：

```json
{
  "action_id": "action-id",
  "status": "completed",
  "execution_id": "execution-id",
  "observation_id": "observation-id",
  "agent_run_id": "run-id"
}
```

重要：

> Action 完成应该产生 Result / Observation，从而允许 Agent 再次运行。

---

# 21. Action 取消

```http
POST /api/v1/projects/{project_id}/actions/{action_id}/cancel
```

```json
{
  "reason": "研究路线发生调整"
}
```

取消本身也可以形成 Observation：

```text
Action cancelled
 ↓
Observation
 ↓
Agent
 ↓
重新判断下一步
```

---

# 22. Execution API

Execution 是 Action 的一次实际执行。

## 获取 Execution

```http
GET /api/v1/projects/{project_id}/actions/{action_id}/executions/{execution_id}
```

---

## 获取 Execution 列表

```http
GET /api/v1/projects/{project_id}/actions/{action_id}/executions
```

---

# 23. 自动执行 Action

对于：

```text
executor_type = agent
executor_type = system
```

Runtime 可以自动创建 Execution。

```text
Action
 ↓
Execution
 ↓
Executor
 ↓
Result
```

Execution 不建议由普通前端直接控制。

---

# 24. Recommendation API

Recommendation 是 Agent 给用户的建议。

## 获取 Recommendation

```http
GET /api/v1/projects/{project_id}/recommendations
```

---

## 获取单条 Recommendation

```http
GET /api/v1/projects/{project_id}/recommendations/{recommendation_id}
```

---

## 接受 Recommendation

```http
POST /api/v1/projects/{project_id}/recommendations/{recommendation_id}/accept
```

---

## 拒绝 Recommendation

```http
POST /api/v1/projects/{project_id}/recommendations/{recommendation_id}/reject
```

Request：

```json
{
  "reason": "目前暂时不采用这个方案"
}
```

---

# 25. Recommendation 与 Action 的关系

例如 Agent 输出：

```text
Recommendation：
建议重新检查实验条件。
```

用户点击：

```text
接受
```

Runtime 可以产生：

```text
Action：
重新检查实验条件
```

所以：

```text
Recommendation
      ↓
Human Decision
      ↓
Action
```

---

# 26. Schedule API

## 获取 Schedule

```http
GET /api/v1/projects/{project_id}/schedules
```

---

## 创建 Schedule

```http
POST /api/v1/projects/{project_id}/schedules
```

例如每天检查：

```json
{
  "type": "cron",
  "expression": "0 9 * * *",
  "payload": {
    "instruction": "检查项目是否存在风险"
  }
}
```

---

# 27. Schedule 类型

```text
once
interval
cron
event
manual
```

---

# 28. 暂停 Schedule

```http
POST /api/v1/projects/{project_id}/schedules/{schedule_id}/pause
```

---

# 29. 恢复 Schedule

```http
POST /api/v1/projects/{project_id}/schedules/{schedule_id}/resume
```

---

# 30. 删除 Schedule

```http
DELETE /api/v1/projects/{project_id}/schedules/{schedule_id}
```

删除后：

```text
status = cancelled
```

而不是物理删除。

---

# 31. Timeline API

Timeline 是前端非常重要的聚合接口。

不建议前端分别请求：

```text
/events
/actions
/recommendations
/observations
```

再自行组合。

提供：

```http
GET /api/v1/projects/{project_id}/timeline
```

### Response

```json
{
  "items": [
    {
      "id": "event-id",
      "type": "event",
      "title": "实验 B 完成",
      "content": "...",
      "created_at": "..."
    },
    {
      "id": "action-id",
      "type": "action",
      "title": "分析实验 B 数据",
      "status": "pending",
      "created_at": "..."
    },
    {
      "id": "recommendation-id",
      "type": "recommendation",
      "content": "建议先分析异常原因",
      "status": "pending",
      "created_at": "..."
    }
  ],
  "next_cursor": "..."
}
```

---

# 32. Project Overview API

前端首页需要的是 Agent 当前状态，而不是数据库表。

因此建议提供：

```http
GET /api/v1/projects/{project_id}/overview
```

返回：

```json
{
  "project": {
    "id": "project-id",
    "name": "X 抗肿瘤作用研究",
    "objective": "验证 X 是否具有抗肿瘤作用",
    "status": "active"
  },

  "state": {
    "current_stage": "动物实验",
    "current_situation": "实验 B 结果异常"
  },

  "open_issues": [
    "实验 B 异常原因未知"
  ],

  "active_actions": [
    {
      "id": "action-id",
      "title": "分析实验 B 数据",
      "priority": "high",
      "status": "pending"
    }
  ],

  "recommendations": [
    {
      "id": "recommendation-id",
      "content": "建议先分析异常原因",
      "priority": "high"
    }
  ],

  "risks": [
    "实验 B 连续两次失败"
  ]
}
```

这个接口直接服务于 Project Agent 首页。

---

# 33. Project Completion API

项目完成不是简单：

```http
PATCH /projects/{id}
status=completed
```

推荐：

```text
Agent 判断
 ↓
Recommendation
 ↓
用户确认
 ↓
POST /completion/confirm
```

接口：

```http
POST /api/v1/projects/{project_id}/completion/confirm
```

Runtime 在执行前检查：

```text
Success Criteria
Critical Open Issues
Necessary Actions
```

确认后：

```text
Project.status = completed
```

---

# 34. Project Pause / Resume

## 暂停

```http
POST /api/v1/projects/{project_id}/pause
```

## 恢复

```http
POST /api/v1/projects/{project_id}/resume
```

暂停：

```text
停止 Schedule 自动触发
停止 Agent 自动运行
```

但可以继续接受用户主动输入。

---

# 35. API 异步模型

Agent API 默认采用异步。

例如：

```http
POST /observations
```

不等待：

```text
PI
 ↓
LLM
 ↓
Tool
 ↓
LLM
```

而是立即返回：

```json
{
  "observation_id": "obs-id",
  "agent_run_id": "run-id",
  "status": "queued"
}
```

前端再：

```http
GET /runs/{run_id}
```

查询状态。

---

# 36. Run 状态查询

```text
queued
running
completed
failed
cancelled
```

前端可以：

```text
queued
 ↓
running
 ↓
completed
```

然后刷新：

```text
State
Timeline
Actions
Recommendations
```

---

# 37. 实时事件

后续可以通过：

```text
WebSocket
SSE
```

推送：

```text
agent.run.started
agent.run.completed
state.updated
action.created
action.completed
recommendation.created
```

例如：

```json
{
  "event": "action.created",
  "project_id": "project-id",
  "data": {
    "action_id": "action-id",
    "title": "分析实验 B 数据"
  }
}
```

MVP 可以先不实现 WebSocket，前端轮询即可。

第 12 节的对话回复已经用 SSE 逐段下发，但它是一条请求自己的响应流，和这里的服务端主动推送不是一回事：Run 状态、State 更新这些事件目前仍然靠前端轮询。

---

# 38. API 错误格式

统一：

```json
{
  "error": {
    "code": "ACTION_NOT_FOUND",
    "message": "Action not found",
    "details": {}
  }
}
```

建议错误码：

```text
PROJECT_NOT_FOUND
PROJECT_ACCESS_DENIED
PROJECT_PAUSED
PROJECT_COMPLETED

SESSION_NOT_FOUND

OBSERVATION_NOT_FOUND

ACTION_NOT_FOUND
ACTION_INVALID_STATE
ACTION_ALREADY_COMPLETED

RECOMMENDATION_NOT_FOUND
RECOMMENDATION_ALREADY_RESOLVED

RUN_NOT_FOUND
RUN_ALREADY_RUNNING
RUN_CONFLICT

SCHEDULE_NOT_FOUND
SCHEDULE_INVALID

STATE_CONFLICT
INVALID_AGENT_OUTPUT

INTEGRATION_NOT_CONFIGURED
INTEGRATION_AUTH_FAILED
INTEGRATION_UNAVAILABLE
MEETING_NOT_FOUND
MEETING_CONTENT_NOT_FOUND

IDEMPOTENCY_CONFLICT
VALIDATION_ERROR
INTERNAL_ERROR
```

---

# 39. HTTP 状态码

```text
200 OK
201 Created
202 Accepted
204 No Content

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
```

其中 Agent 异步运行：

```http
202 Accepted
```

---

# 40. Idempotency

涉及创建 Agent 运行的接口支持：

```http
Idempotency-Key: xxx
```

例如：

```http
POST /api/v1/projects/{project_id}/observations
Idempotency-Key: request-001
```

重复请求：

```text
request-001
request-001
```

只能产生一次 Observation / Agent Run。

---

# 41. 权限模型

所有 Project API 首先检查：

```text
User
 ↓
project_users
 ↓
Project
```

只有 Project 成员才能访问 Project 数据。

核心规则：

> **Project 是数据隔离边界。**

例如：

```text
User A
 ├── Project 1 ✓
 └── Project 2 ✗
```

即使知道 Project 2 的 UUID，也不能访问。

---

# 42. API 与 Runtime 的关系

API Layer 不直接实现 Agent Loop。

错误：

```text
API
 ↓
PI
 ↓
写数据库
```

正确：

```text
API
 ↓
Runtime Service
 ↓
Agent Run
 ↓
Context
 ↓
Agent Engine
 ↓
Output Processor
 ↓
Persistence
```

API 只是 Runtime 的入口。

---

# 43. 推荐的后端目录结构

```text
src/
├── api/
│   ├── projects/
│   ├── sessions/
│   ├── observations/
│   ├── events/
│   ├── actions/
│   ├── executions/
│   ├── recommendations/
│   ├── schedules/
│   └── runs/
│
├── runtime/
│   ├── agent-run/
│   ├── trigger/
│   ├── context/
│   ├── output/
│   ├── state/
│   ├── memory/
│   └── execution/
│
├── engine/
│   ├── interface/
│   └── pi/
│
├── services/
│   ├── project/
│   ├── observation/
│   ├── action/
│   └── schedule/
│
├── workers/
│   ├── agent-run.worker
│   ├── execution.worker
│   └── schedule.worker
│
└── db/
    ├── models/
    └── repositories/
```

---

# 44. MVP API 最小集合

第一版实际上不需要实现所有 API。

只需要：

### Project

```text
POST   /projects
GET    /projects
GET    /projects/{id}
PATCH  /projects/{id}
```

### Project State

```text
GET /projects/{id}/state
GET /projects/{id}/overview
```

### Chat / Observation

```text
POST /projects/{id}/chat
POST /projects/{id}/observations
```

### Agent Run

```text
GET /projects/{id}/runs/{run_id}
```

### Action

```text
GET  /projects/{id}/actions
GET  /projects/{id}/actions/{action_id}
POST /projects/{id}/actions/{action_id}/complete
POST /projects/{id}/actions/{action_id}/cancel
```

### Recommendation

```text
GET  /projects/{id}/recommendations
POST /projects/{id}/recommendations/{id}/accept
POST /projects/{id}/recommendations/{id}/reject
```

### Timeline

```text
GET /projects/{id}/timeline
```

### Schedule

```text
GET  /projects/{id}/schedules
POST /projects/{id}/schedules
POST /projects/{id}/schedules/{id}/pause
POST /projects/{id}/schedules/{id}/resume
```

---

# 45. API 核心关系

最终 API 层可以归纳为：

```text
                    Project
                       │
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
       State        Observation    Action
                         │             │
                         ↓             ↓
                      Agent Run     Execution
                         │             │
                         ↓             ↓
                  Recommendation     Result
                         │             │
                         └──────┬──────┘
                                ↓
                           Observation
                                ↓
                             Agent Run
```

---

# 46. API 设计的核心原则

## 46.1 API 不暴露 Agent 内部实现

前端不应该知道：

```text
PI
Prompt
Context Builder
Tool Calling
Memory Retrieval
```

这些属于 Runtime 内部。

---

## 46.2 API 围绕业务事实设计

核心 API 是：

```text
Project
Observation
Action
Recommendation
State
```

而不是：

```text
Prompt
LLM
Chat Completion
```

---

## 46.3 Observation 是统一入口

无论来源：

```text
Chat
Meeting
Document
Schedule
External API
Action Result
```

最终都可以转换成：

```text
Observation
```

这样 Runtime 才能保持统一。

---

## 46.4 Agent Run 是内部运行单元

用户不需要理解：

```text
Agent Run
```

但开发必须围绕它构建。

因为它负责：

```text
一次 Trigger
→ 一次 Agent Runtime
→ 一次状态变化过程
```

---

## 46.5 Action 是 Agent 的执行出口

Agent 的价值不是产生文字，而是：

```text
Think
 ↓
Action
 ↓
现实发生变化
 ↓
Result
 ↓
新的 Observation
```

所以 Action 是 LOOP API 中非常重要的核心资源。

---

# 47. 实现补充的接口

第 4 到 34 节定义的是 LOOP 的对外主接口。实现时为前端和测试补了几个不改变主模型的接口，它们都属于既有资源的查询或状态流转，不引入新概念。

```text
GET    /api/v1/users
GET    /api/v1/projects/{project_id}/sessions
POST   /api/v1/projects/{project_id}/actions/{action_id}/fail
POST   /api/v1/projects/{project_id}/runs                 支持 wait=true
POST   /api/v1/projects/{project_id}/schedules            支持 run_now=true
```

- `GET /users` 返回用户清单，供前端选择 Action 负责人。MVP 没有独立的人员目录接口，先由它承担。
- `GET /sessions` 按创建时间倒序返回 Session，前端进入 Chat 时用它找回最近一次会话。
- `POST /actions/{action_id}/fail` 与已有的 complete、cancel 并列：失败同样产生 Execution 和 Observation，让 Agent 知道“这次尝试没有成功”。第 20 节的 complete 接口只覆盖成功路径。
- `POST /runs` 的 `wait=true` 会同步执行完这次 Agent Run 再返回，用于调试和端到端测试；默认仍然是异步返回 `202 Accepted`。
- `POST /schedules` 的 `run_now=true` 会把 `next_run_at` 设为当前时间并立刻扫描一次，用于验证 Schedule 触发链路。它仍然经过第 38 节的幂等表，不会绕过去重。

实现人工确认闸门后，新增下面这组接口：

```text
POST   /api/v1/projects/{project_id}/actions/{action_id}/confirm
POST   /api/v1/projects/{project_id}/actions/{action_id}/decline
GET    /api/v1/projects/{project_id}/state/proposals
POST   /api/v1/projects/{project_id}/state/proposals/{proposal_id}/apply
POST   /api/v1/projects/{project_id}/state/proposals/{proposal_id}/reject
POST   /api/v1/dev-login
```

- Agent 产出的 Action 先处于 `proposed`，用户 `confirm` 后才进入 `pending`，`decline` 则转为 `cancelled`。用户通过 `POST /actions` 直接创建的 Action 不需要确认，直接是 `pending`。
- State 的结构性变更（阶段、开放问题、风险、未知项）先落 `state/proposals`，用户 `apply` 后应用，`reject` 则丢弃。
- `POST /completion/confirm` 不再接受 `force`，必须引用 Agent 提出的 `type=completion` 的 Recommendation；Runtime 会校验没有未完成 Action 和开放问题后才完成。
- `POST /dev-login` 只在开发环境开放，用于前端拿到开发用户身份。业务接口不再对无 `X-User-Id` 的请求做身份回落。
- `GET /projects/{project_id}/timeline` 支持 `cursor` 游标分页，响应带 `next_cursor`。
- `POST /projects/{project_id}/archive` 把 Project 置为 `archived`，之后不再接受新的触发。
- `GET /notifications`、`POST /notifications/{id}/read`、`POST /notifications/read-all` 提供跨 Project 的通知列表与已读操作，`GET /notifications/unread-count` 返回未读数。列表、未读数和 read-all 都接受 `project_id`（read-all 放在请求体里）：带上它就把范围收窄到这一个 Project，未读数也只算这一个，不带就是当前用户所有 Project。收窄仍然建立在成员校验之上，自己没参与的 Project 拿不到任何通知。
- Action 带 `kind`（task / meeting / document），`POST /actions` 创建时指定；`POST /actions/{id}/complete` 的 `result.output` 接收该类型对应的结构化字段（会议：participants/decisions/action_items，资料：key_points/content，任务：results/blockers），Runtime 会把结构化结果整理进 Observation。
- `GET /projects/{project_id}/actions/{action_id}` 额外返回 `source`（来源事件、建议、触发观察与智能体判断）和 `analysis`（该 Action 完成后智能体后续运行的分析结论），供详情页展示“为什么产生这个 Action”和“执行之后智能体怎么看”。

资料（kind=document）行动的文档与整理接口：

```text
POST   /api/v1/projects/{project_id}/actions/{action_id}/documents/upload
POST   /api/v1/projects/{project_id}/actions/{action_id}/documents/import-url
GET    /api/v1/projects/{project_id}/actions/{action_id}/documents/{document_id}/file
DELETE /api/v1/projects/{project_id}/actions/{action_id}/documents/{document_id}
POST   /api/v1/projects/{project_id}/actions/{action_id}/organize
```

- `POST /documents/upload` 是 multipart 请求，字段名 `files`，支持一次多文件；单文件大小上限 `UPLOAD_MAX_BYTES`（默认 25MB），一次最多 10 个，任何一个文件超限整个请求失败、不留下部分结果。服务端同步提取文本入库，响应 `201 { items }`。
- `POST /documents/import-url` 接收 `{ url, name? }`，只支持 http/https 直链，抓取受超时与大小上限约束；导入后只保存元数据与提取文本，不保存字节。
- `GET /documents/{document_id}/file` 只对 upload 来源有效，校验项目访问后流式返回文件字节（inline）。URL 来源没有本地文件，前端直接用原链接预览。
- 文档元数据列表随 `GET /actions/{action_id}` 的 `documents` 字段返回（名称、来源、大小、`parse_status`、`extracted_chars`、解析错误），不带全文。
- 上传、导入和删除只在行动处于 `pending` / `running` 时开放；完成后文档定稿，仍然可见可预览，但不再允许增删。
- `POST /organize` 是 AI 整理：把资料的文档文本交给 Engine，返回 `{ summary, key_points, content }` 草稿。草稿不落库、不触发 Agent Run，由用户在详情页修订后随 `complete` 一起提交；没有可解析文本的资料行动返回 422。

腾讯会议集成接口：

```text
GET    /api/v1/me/integrations/tencent-meeting
PUT    /api/v1/me/integrations/tencent-meeting          { token }
DELETE /api/v1/me/integrations/tencent-meeting
GET    /api/v1/me/integrations/tencent-meeting/meetings?from=&to=&page_token=
POST   /api/v1/projects/{project_id}/actions/{action_id}/meeting-import
       { meeting_id?, meeting_code?, sub_meeting_id?, started_at?, ended_at? }
```

- 个人 Token 按用户保存，使用 AES-256-GCM 加密；`GET` 只返回 `{ configured, masked_token, updated_at }`，不返回原文。
- `PUT` 先调用腾讯会议 MCP 的已结束会议列表验证 Token，验证失败不落库。
- `DELETE` 解除当前用户的绑定，已经导入的会议快照保留。
- `GET meetings` 默认返回近 7 天已结束的会议，`from` / `to` 跨度最多 31 天；响应带 `has_more` 和 `next_page_token`。
- `POST /meeting-import` 只允许 `kind=meeting` 且状态为 `pending` / `running` 的 Action；`started_at` / `ended_at` 传列表里选中那一场会议的时间，周期会议靠它定位到具体实例。服务端通过腾讯会议 MCP 读取纪要、参会人和逐字稿，保存 `action_meeting_imports` 快照并返回 `{ meeting_import }`。
- Action 详情响应增加 `meeting_import`，没有导入过时为 `null`。快照包含 `summary`（会议结论）、`participants`、`minutes`、`todos`、`transcript` 等字段；完整逐字稿只保存在快照中，不写入 Agent Observation。
- 完成 Action 时，提交的参与人、纪要、决定和后续行动会进入 Observation，逐字稿不会。当前会议详情页只提交参与人和纪要，决定与待办的内容直接写在纪要里。
- 腾讯会议 MCP 的端点、鉴权、工具和限制见 `docs/design/08-tencent-meeting-integration.md`。

登录与注册：

```text
POST   /api/v1/auth/register   { email, password, name } → { user, token }
POST   /api/v1/auth/login      { email, password } → { user, token }
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

注册和登录返回一个不透明访问令牌，之后所有业务接口用 `Authorization: Bearer <token>` 携带身份；`X-User-Id` 仅作为开发环境的兜底保留。令牌用 sha256 摘要存库，有效期 30 天。

另外，Run 记录里的 `error.code` 取值来自第 38 节的错误码和 Agent Engine 的错误码（`ENGINE_TIMEOUT`、`ENGINE_INVALID_OUTPUT` 等），前端可以直接按错误码判断是否需要重试。

---

# 48. 最终 API 模型

LOOP API 可以浓缩成一句话：

> **用户通过 Observation 告诉 Agent 世界发生了什么；Agent Runtime 通过 State、Recommendation 和 Action 推动 Project 继续向目标前进。**

核心接口链：

```text
POST /projects/{id}/observations
                ↓
        Agent Runtime
                ↓
GET /projects/{id}/runs/{run_id}
                ↓
       State / Event
       Action / Recommendation
                ↓
POST /actions/{id}/complete
                ↓
           Observation
                ↓
        Agent Runtime
                ↓
             Loop
```

因此 LOOP API 不是传统的：

```text
CRUD Project
CRUD Task
CRUD Meeting
```

而是：

```text
Create Project
      ↓
Observe
      ↓
Run Agent
      ↓
Review Recommendation
      ↓
Execute Action
      ↓
Report Result
      ↓
Observe
      ↓
Run Agent
```

这才是 LOOP API 与普通项目管理系统 API 的根本区别。

---

## 修改历史

- 2026-10-19：第 47 节会议导入快照增加 `summary`（会议结论）；会议详情页只提交参与人和纪要，决定与后续行动不再单独提交，内容随纪要进入 Observation。
- 2026-10-18：第 47 节 `meeting-import` 请求体补充可选 `started_at` / `ended_at`，周期会议用它定位到选中的那一场实例。
- 2026-10-18：第 47 节新增腾讯会议集成接口：个人 Token 绑定/解绑/状态、已结束会议列表、会议内容导入；Action 详情响应增加 `meeting_import`，逐字稿只存快照不进入 Observation。第 38 节补充 `INTEGRATION_*` 与 `MEETING_*` 错误码。
- 2026-10-16：第 12 节的会话思考结果改为返回本轮全部产出（不再只取待处理状态），每条带 `status`，处理过的保留在原位显示结果；行动数组由 `proposed_actions` 改名为 `actions`。
- 2026-10-16：第 12 节 `POST /chat` 增加 `reasoning` 事件，模型的推理过程单独下发并随消息存进 `metadata.reasoning`，只用于展示。
- 2026-10-16：第 12 节 `POST /chat` 的响应改为 SSE 流（`session` / `delta` / `done` / `error` 事件）；补充两种失败情形的约定（未输出内容时返回普通 JSON 错误，输出到一半失败时保留半截回复并标记中断），以及幂等键重复提交的回放方式。第 37 节补充说明对话的 SSE 响应与服务端主动推送的区别。
- 2026-10-15：第 47 节的通知接口补充 `project_id` 范围参数，列表、未读数与 read-all 都可以只看一个 Project。
- 2026-10-14：第 47 节补充资料文档接口（上传、URL 导入、文件下载、删除）与 `POST /organize` AI 整理接口；第 12 节 Chat 请求增加可选 `document_id`，支持把资料文本作为对话上下文。
- 2026-10-13：第 12 节补充多会话支持：`GET /sessions` 携带 `preview` 与 `message_count` 并按创建时间倒序，`POST /chat` 不带 `session_id` 时创建新会话。
- 2026-10-12：第 12 节 Chat API 更新为“对话 + 思考分离”：`POST /chat` 同步返回讨论回复，回复后自动提交 `conversation` Observation 触发思考；新增 `GET /sessions/{id}/runs` 提供思考结果。
- 2026-10-12：移除腾讯会议 Token 配置和 meeting Action 按需同步接口，会议记录回归手工填写。
- 2026-10-05：新增第 47 节“实现补充的接口”，登记用户清单、Session 列表、Action 失败、手动 Run 同步执行和 Schedule 立即触发这几个实现期补充的接口。
- 2026-10-05：第 47 节补充 Action 确认/拒绝、State Proposal 应用/拒绝、完成确认约束和开发登录接口，把人工确认闸门纳入对外契约。
- 2026-10-05：第 47 节补充 timeline 游标分页和归档接口。
- 2026-10-05：第 47 节补充通知列表与已读接口。
- 2026-10-05：第 47 节补充登录/注册与 Bearer 令牌鉴权接口。
- 2026-10-05：第 47 节补充腾讯会议 Token 配置和 meeting Action 按需同步接口。
