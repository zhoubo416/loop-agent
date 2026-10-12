# 前端 UI 设计

## 1. 设计目标

LOOP 前端不是传统的项目管理系统。

核心目标是让用户能够清楚看到：

1. **这个 Project 要完成什么**
2. **Agent 认为现在发生了什么**
3. **目前有哪些重要问题**
4. **现在需要做什么**
5. **Agent 建议下一步做什么**
6. **过去发生了什么**
7. **我可以直接和 Project Agent 对话**

因此前端围绕：

> **Project → State → Observation → Recommendation → Action → Result**

展开。

而不是：

> Project → Task List → Calendar → Gantt

---

# 2. 核心 UI 原则

## 2.1 Project 就是 Agent

前端不要把：

```text
Project
Agent
```

设计成两个概念。

用户进入一个 Project，实际上就是进入一个 Agent。

例如：

```text
蛋白 X 机制研究

这是一个持续运行的 Agent。
```

用户不是在“管理一个项目”，而是在：

> **与这个 Project 一起工作。**

---

## 2.2 首页优先展示“现在”

首页最重要的信息不是历史数据，而是：

```text
目标
当前状态
当前阶段
开放问题
正在执行
AI 建议
```

用户打开页面后，应该在几秒钟内知道：

> **项目现在怎么样？我接下来应该做什么？**

---

## 2.3 AI 不应该占据整个页面

LOOP 不是聊天机器人。

Chat 是 Agent 的一种交互方式，但不是产品主体。

页面应该以：

```text
Project State
+
Actions
+
Timeline
```

为主体。

AI 通过推荐、提醒、状态变化和对话参与项目。

---

# 3. 信息架构

MVP 采用以下结构：

```text
LOOP
│
├── Projects
│
└── Project
    │
    ├── Overview
    ├── Chat
    ├── Timeline
    ├── Actions
    └── Settings
```

其中：

### Overview

项目当前状态。

### Chat

直接与 Project Agent 对话。

### Timeline

查看项目发生过的重要事件、决策、行动和结果。

### Actions

查看当前需要执行的行动。

### Settings

项目成员、目标、成功标准、Agent 配置等。

---

# 4. 全局布局

建议采用非常克制的三层结构：

```text
┌──────────────────────────────────────────────┐
│ LOOP                              User       │
├──────────────┬───────────────────────────────┤
│              │                               │
│  Projects    │                               │
│              │        Project Content        │
│  ─────────   │                               │
│              │                               │
│  Project A   │                               │
│  Project B   │                               │
│  Project C   │                               │
│              │                               │
│              │                               │
│              │                               │
└──────────────┴───────────────────────────────┘
```

左侧只负责：

* Project 切换
* 创建 Project
* 全局导航

不要在侧边栏堆大量功能。

## 4.1 布局与滚动

页面内容在一屏宽度内完整展示，不出现横向滚动；内容超出一屏高度时使用页面纵向滚动。侧边栏在桌面端吸在视口左侧，页面滚动时保持可见，侧边栏内容过长时自己滚动；窄屏（900px 以下）退化为顶部栏，不吸边。承载长文本的网格列必须限制最小宽度（`min-width: 0`）并允许换行，长字符串不得撑破容器。

## 4.2 页面过渡与加载反馈

* 页面切换统一使用 200ms 的淡入淡出加轻微位移过渡，不做夸张动效。
* 路由导航等待新页面数据期间，顶部显示进度条，让用户知道页面正在响应。
* 数据未就绪时显示与真实内容形状一致的骨架屏；空态文案只在数据确实为空时出现，加载过程中不得显示“没有数据”类的误导文案；手动刷新时保留旧内容，不闪骨架。
* 同一页面的多个数据请求并行发出，不串行等待。

---

# 5. Project 列表

Project 列表是用户进入 LOOP 后看到的第一层。

建议：

```text
Projects

+ New Project

────────────────────

Protein X Research
研究蛋白 X 对肿瘤细胞的影响
Active · 实验验证

────────────────────

AI Product
构建个人 AI Agent 产品
Active · 产品验证

────────────────────

English
提升英文阅读能力
Paused
```

每个 Project 最多展示：

* 名称
* Objective
* Status
* Current Stage

不要展示：

* Task 数量
* 完成百分比
* 甘特图
* 大量统计数据

因为 LOOP 不是传统 Todo/Project Management。

---

# 6. Project Overview

这是整个系统最重要的页面。

建议结构：

```text
┌───────────────────────────────────────────────┐
│ Protein X Research                    Active  │
│                                               │
│ 验证蛋白 X 是否影响肿瘤细胞增殖               │
│                                               │
├───────────────────────────────────────────────┤
│                                               │
│ 当前状态                                      │
│                                               │
│ 正在进行第二轮细胞实验。第一轮结果已经完成， │
│ 第二轮出现异常，需要进一步确认实验条件。      │
│                                               │
│ 当前阶段                                      │
│ 实验验证                                      │
│                                               │
├──────────────────────┬────────────────────────┤
│ Open Issues           │ AI Recommendation      │
│                      │                        │
│ 第二组数据异常       │ 建议先检查实验条件，   │
│                      │ 再决定是否重复实验。   │
│                      │                        │
├──────────────────────┴────────────────────────┤
│                                               │
│ Active Actions                                │
│                                               │
│ □ 检查第二组实验条件          张三            │
│ □ 分析第一轮实验数据          李四            │
│ □ 查找相关异常原因文献        王五            │
│                                               │
├───────────────────────────────────────────────┤
│                                               │
│ Recent Activity                               │
│                                               │
│ 今天  第二轮实验出现异常                       │
│ 昨天  完成第一轮实验                           │
│ 09-28 确定实验方案                             │
│ 09-26 完成文献调研                             │
│                                               │
└───────────────────────────────────────────────┘
```

---

# 7. Overview 信息优先级

页面信息优先级固定为：

```text
1. Objective
2. Current State
3. Open Issues
4. AI Recommendation
5. Active Actions
6. Recent Activity
```

其中：

### Objective

回答：

> 这个 Project 为什么存在？

### Current State

回答：

> 现在发生了什么？

### Open Issues

回答：

> 现在还有什么问题？

### AI Recommendation

回答：

> Agent 认为下一步应该做什么？

### Active Actions

回答：

> 当前具体需要执行什么？

### Recent Activity

回答：

> 最近发生了什么？

---

# 8. Current State

Current State 是首页的核心。

不要展示成复杂 Dashboard。

建议采用一段自然语言 + 少量结构化信息：

```text
当前状态

项目正在进行第二轮实验验证。

第一轮实验已经完成，结果基本符合预期。
第二轮实验出现异常，目前无法判断是实验条件
还是样本本身造成。

当前需要优先确认异常原因。
```

下面补充：

```text
阶段
实验验证

风险
数据异常

开放问题
异常原因尚未确认
```

这样比：

```text
项目进度 63%
任务完成率 72%
风险指数 38
```

更符合 LOOP。

---

# 9. AI Recommendation

Recommendation 是 Agent 主动工作的主要表现。

例如：

```text
AI Recommendation

我发现第二组实验已经连续 5 天没有新的结果。

结合最近的实验记录，我认为目前最值得先确认
的是实验条件，而不是直接重新实验。

建议：

[检查实验条件]     [暂不处理]
```

重要推荐应该支持：

```text
Accept
Reject
```

而不是直接修改项目状态。

---

# 10. AI Risk

Risk 不需要独立做成复杂 Dashboard。

可以在 Overview 中作为 AI 提醒出现：

```text
AI 注意到

第二组实验已经 5 天没有新的结果。

如果本周仍没有进展，可能需要重新评估当前实验路线。

查看原因 →
```

风险可以来自：

### Action 长期没有进展

```text
14 天没有新的相关 Event
```

### Action 连续失败

```text
同一路线已经失败 3 次
```

### Project 偏离目标

```text
最近大量活动与 Project Objective
没有直接关系
```

### Project 长时间没有变化

```text
30 天没有新的重要 Event
```

---

# 11. Chat

Chat 是用户与 Project Agent 的直接交互入口。

但视觉上不要做成：

> ChatGPT + 项目名称

而应该让用户感觉：

> **我正在和这个 Project 本身沟通。**

例如：

```text
Protein X Research

┌─────────────────────────────────────┐

你：
第二轮实验为什么会出现异常？

Agent：

根据目前项目中的实验记录，我还不能确定原因。

目前比较明显的两个可能性是：

1. 实验条件发生变化
2. 样本本身存在差异

我建议先检查第二轮实验条件。

相关记录：
• 09-28 实验方案确定
• 09-30 第一轮实验完成
• 10-02 第二轮出现异常

[检查实验条件]

你：
那我先让张三检查一下。

Agent：
好的。

我建议创建一个 Action：

检查第二轮实验条件
负责人：张三

[确认创建]

└─────────────────────────────────────┘
```

---

# 12. Chat 的核心能力

Chat 不只是问答。

用户输入：

```text
实验已经做完了
```

Agent 应该理解为：

```text
Observation

↓

Event
实验完成

↓

关联 Action
完成实验

↓

Action = Completed

↓

Think

↓

产生新的 Recommendation / Action
```

因此 Chat 是：

> **Agent 操作入口**

而不是单纯的信息问答入口。

---

# 13. Action 页面

Action 页面只展示：

> **现在真正需要做什么。**

建议：

```text
Actions

Active

┌─────────────────────────────────────┐
│ 检查第二组实验条件                  │
│ 张三 · High                         │
│ 2 days                              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 分析第一轮实验数据                  │
│ 李四 · Medium                       │
│                                     │
└─────────────────────────────────────┘

Completed

✓ 完成第一轮细胞实验
✓ 确定实验浓度
✓ 完成文献调研
```

不要把 Action 做成复杂任务管理系统。

MVP 不需要：

* 子任务
* Checklist
* 工时
* Kanban
* Gantt
* 复杂依赖关系

---

# 14. Action Detail

Action Detail：

```text
检查第二组实验条件

负责人
张三

状态
Running

产生原因
第二组实验出现异常

创建时间
2026-10-02

────────────────────

为什么需要做？

第二组实验结果与第一组存在明显差异，
目前无法确认原因。

────────────────────

Execution

10-02
Action created

10-03
张三开始检查

────────────────────

[完成]    [取消]
```

重点展示：

> 为什么产生这个 Action？

而不是只展示：

> Action 是什么。

因为 LOOP 的 Action 是 Agent 根据 Project State 推导出来的。

---

# 15. Timeline

Timeline 是 LOOP 非常重要的页面。

它展示 Project 的状态演化：

```text
Timeline

10-05

Event
第二轮实验结果出现异常

AI Recommendation
建议检查实验条件

Action
检查第二组实验条件
张三

────────────────

10-03

Event
第一轮实验完成

Action
分析第一轮实验数据
李四

────────────────

09-28

Decision
确定第二轮实验方案

Action
完成第二轮实验

────────────────

09-25

Event
完成文献调研
```

Timeline 不应该只是操作日志。

它应该是：

> **Project State 的演化记录。**

---

# 16. Timeline 中的内容类型

主要展示：

```text
Observation
Event
Decision
Recommendation
Action
Result
State Change
```

视觉上可以通过简单的类型标识区分。

例如：

```text
● Event
● Decision
● Action
● Result
```

不需要复杂颜色体系。

---

# 17. Observation / Event 的关系

用户上传：

```text
实验报告.pdf
```

或者输入：

```text
今天实验完成了，但是第二组数据异常。
```

首先进入：

```text
Observation
```

Agent 分析后产生：

```text
Event
实验完成

Event
第二组数据异常
```

然后：

```text
Think

↓

Recommendation

↓

Action
```

所以 UI 不需要让用户手动选择：

```text
这是 Event
这是 Action
这是 Observation
```

系统应该自动判断。

---

# 18. Meeting

MVP 可以把 Meeting 放在 Chat / Observation 体系中，而不是单独建立一套完全独立的业务模型。

用户可以：

```text
开始会议
```

会议结束后：

```text
上传录音
上传 transcript
输入会议内容
```

Agent 自动处理：

```text
Meeting Observation

↓

Event
Decision
Action
Risk
```

然后用户确认。

例如：

```text
会议总结

Agent 识别到：

3 个 Event
2 个 Decision
4 个 Action
1 个 Risk

────────────────────

Event

✓ 第一轮实验完成

✓ 第二轮实验出现异常

────────────────────

Decision

✓ 暂时不重复实验

────────────────────

Action

□ 检查实验条件
□ 分析实验数据
□ 查找相关文献

[确认并更新项目]
```

---

# 19. Project 创建

Project 创建应该非常简单。

不要设计复杂的项目创建 Wizard。

核心只需要：

```text
Create Project

项目名称

________________________

你希望这个 Project 最终完成什么？

________________________
________________________

成功标准（可选）

________________________

[Create Project]
```

创建之后，Agent 可以继续通过对话理解 Project。

例如：

```text
你：
我想研究蛋白 X 是否影响肿瘤细胞增殖。
```

Agent：

```text
我理解这个 Project 的目标是：

验证蛋白 X 是否影响肿瘤细胞增殖。

如果这个理解正确，我们就从这里开始。
```

---

# 20. Project Settings

Settings 不需要复杂。

主要包含：

### Basic

```text
Name
Objective
Description
Success Criteria
```

### Members

```text
Owner
Admin
Member
Viewer
```

### Agent

```text
Agent Status
Active / Paused

Schedule

Timezone

Notification
```

### Danger Zone

```text
Pause Project
Archive Project
```

---

# 21. Project Status

Project 状态：

```text
Created
Active
Paused
Completed
Archived
```

其中：

### Active

Agent 正常运行。

### Paused

暂时停止 Agent 的主动运行，但数据保留。

### Completed

Project 已经达到成功标准，并经过用户确认。

### Archived

不再参与日常 Project 列表。

---

# 22. Project 完成

不要设计：

```text
[Mark as Completed]
```

作为主要完成机制。

应该由 Agent 判断：

```text
Success Criteria 已满足

+

没有 Critical Open Issue

+

没有必要继续执行的 Action

↓

Agent Recommendation

“我认为这个 Project 已经达到完成条件。”

[完成 Project]
```

用户确认后：

```text
Project
   ↓
Completed
```

这样 Project 的生命周期才真正由 Agent 驱动。

---

# 23. Schedule

Schedule 不需要独立成为主要导航。

它是 Agent 的后台能力。

用户可以在 Settings 中设置：

```text
Agent Schedule

每天 09:00
检查项目是否有新的风险

每周一
总结过去一周项目变化

每周五
检查长期未完成 Action
```

触发后：

```text
Schedule
   ↓
Wake Agent
   ↓
Observation
   ↓
Think
   ↓
Recommendation / Action
```

如果没有任何重要变化：

> Agent 不需要打扰用户。

---

# 24. Notification

Notification 的核心不是：

> 有什么东西更新了？

而是：

> **Agent 认为现在值得你知道。**

例如：

```text
LOOP

Protein X Research

Agent 发现一个问题：

第二组实验已经连续 5 天没有新的结果。

[查看 Project]
```

或者：

```text
Project 已经发生重要变化

第一轮实验结果已经完成。
Agent 已经根据结果生成下一步建议。

[查看]
```

避免传统项目系统大量：

* Task reminder
* Deadline reminder
* Comment reminder
* Like reminder

LOOP 的通知应该以：

> **Agent Judgment**

为中心。

---

# 25. Empty State

LOOP 的 Empty State 不应该只是：

```text
No Data
```

而应该引导用户让 Agent 开始工作。

例如新 Project：

```text
这个 Project 还没有发生任何事情。

告诉我你现在在做什么。

┌─────────────────────────────────────┐
│ 我们刚刚开始研究蛋白 X……             │
└─────────────────────────────────────┘

[发送]
```

用户输入后：

```text
Observation
   ↓
Think
   ↓
Project State
```

Project 开始运行。

---

# 26. Agent 工作状态

当 Agent 正在处理信息时，可以显示：

```text
Agent is working...

正在整理最近的信息
↓
检查当前 Action
↓
更新 Project State
```

但不要展示内部 Chain of Thought。

不显示：

```text
思考过程：
首先我认为……
然后我推测……
所以……
```

只展示：

> 正在处理什么，以及最终产生什么结果。

---

# 27. Agent Run 页面

Agent Run 主要用于调试和管理员，不是普通用户的核心页面。

可以查看：

```text
Run #1024

Trigger
Observation

Started
10:23:11

Status
Completed

Input
第二轮实验出现异常

Output

State Updated
✓

Recommendation Created
✓

Action Created
✓
```

内部信息如：

* Prompt
* Context Builder
* Tool Call
* PI Agent execution

默认不直接暴露给普通用户。

---

# 28. 响应式布局

桌面端优先。

推荐：

```text
Sidebar
240px

Main Content
flex: 1

Optional Right Panel
320px
```

Overview 可以：

```text
┌──────────────┬──────────────────────────┐
│ Sidebar      │ Main                     │
│              │                          │
│ Projects     │ Project Header           │
│              │                          │
│              │ Current State            │
│              │                          │
│              │ Actions / Recommendation │
│              │                          │
│              │ Timeline                 │
└──────────────┴──────────────────────────┘
```

不要同时使用三个以上复杂栏。

---

# 29. 移动端

移动端不需要完整复制桌面端。

重点保留：

```text
Project State
Actions
Recommendation
Chat
Timeline
```

底部导航：

```text
Overview
Actions
Chat
Timeline
```

Project Settings 放在更多菜单中。

---

# 30. MVP 页面范围

第一版只实现：

```text
1. Project List

2. Project Overview

3. Project Chat

4. Project Timeline

5. Actions

6. Action Detail

7. Project Settings
```

其中：

```text
Overview
   ↓
Chat
   ↓
Observation
   ↓
Agent Run
   ↓
State
   ↓
Recommendation
   ↓
Action
   ↓
Execution
   ↓
Result
   ↓
Timeline
```

这已经能够完整体现 LOOP 的核心机制。

---

# 31. MVP 暂不实现

第一版不要做：

* Gantt
* Kanban
* KPI Dashboard
* 工时统计
* 项目进度百分比
* 复杂报表
* 独立知识库
* 独立 Memory 页面
* 复杂会议管理
* 复杂任务层级
* 日历中心
* 多 Agent 协作
* Agent Marketplace
* Agent 人格系统

这些功能都会把 LOOP 拉回传统项目管理产品。

---

# 32. UI 与 Agent Runtime 的对应关系

前端页面应该能够映射到 Runtime 的核心对象：

| UI             | Runtime                               |
| -------------- | ------------------------------------- |
| Project        | Project / Agent                       |
| Current State  | Agent State                           |
| Chat           | Session + Observation                 |
| Timeline       | Observation / Event / Action / Result |
| Recommendation | Recommendation                        |
| Actions        | Action                                |
| Action Detail  | Action + Execution                    |
| Notification   | Recommendation / Trigger              |
| Schedule       | Schedule                              |
| Agent Activity | Agent Run                             |

前端不直接依赖：

```text
PI Agent
Prompt
Context Builder
Tool Calling
```

这些都属于 Runtime 内部实现。

---

# 33. 最核心的页面关系

整个 UI 可以最终压缩成：

```text
                    Project
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       State         Chat       Timeline
          │            │            │
          │       Observation       │
          │            ↓            │
          │        Agent Run        │
          │            │            │
          └───────→ Recommendation │
                       │            │
                       ↓            │
                     Action ────────┘
                       │
                       ↓
                   Execution
                       │
                       ↓
                    Result
                       │
                       ↓
                  New Observation
                       │
                       ↓
                     Agent
```

这就是 LOOP 前端最重要的交互闭环。

---

# 34. 最终设计原则

LOOP UI 最终应该坚持以下原则：

### 1. 不做传统项目管理软件

不要让用户管理大量结构化数据。

### 2. Project 是第一等公民

用户进入 Project，就是进入一个长期运行的 Agent。

### 3. State 是首页核心

用户最关心的是：

> 现在发生了什么？

### 4. Action 是执行出口

用户真正需要看到的是：

> 现在应该做什么？

### 5. Timeline 是项目记忆

用户可以随时理解：

> 项目是怎么走到今天的？

### 6. Chat 是 Agent 操作入口

用户通过自然语言告诉 Agent：

> 发生了什么、我想做什么、我发现了什么。

### 7. Recommendation 是 Agent 主动性的体现

Agent 不只是等待用户提问。

### 8. 不暴露 Agent 内部推理

展示：

```text
Observation
判断结果
Recommendation
Action
```

而不是 Chain of Thought。

### 9. 页面尽量克制

LOOP 的价值来自：

> **Agent 持续运行**

而不是来自：

> **页面功能很多。**

---

# 35. LOOP UI 的核心体验

最终用户打开 LOOP，不应该产生：

> “这是一个项目管理工具。”

而应该产生：

> **“这是我的 Project，它知道现在发生了什么，并且一直在帮我往目标推进。”**

这才是 LOOP UI 与普通 Project Management Software 最核心的区别。

---

## 修改历史

- 2026-10-12：第 4 节新增 4.1 与 4.2，约定一屏宽度展示与纵向滚动、侧边栏吸边、页面过渡动效、加载骨架与空态条件。
- 2026-10-12：移除会议详情页按需同步腾讯会议内容的交互设计，会议记录回归手工填写。
