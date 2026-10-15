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

侧边栏是常驻的工作台，页面内容在右侧展开：

```text
┌───────────────────────┬────────────────────────────────────┐
│ LOOP                  │                                    │
│ 一个项目,就是一个智能体 │                                    │
│ ┌───────────────────┐ │                                    │
│ │ 蛋白 X 机制研究  ▾ │ │                                    │
│ │ Active · 实验验证  │ │                                    │
│ └───────────────────┘ │        Project Content             │
│                       │                                    │
│ 概览                  │                                    │
│ 时间线                │                                    │
│ 行动                  │                                    │
│ 设置                  │                                    │
│ ───────────────────── │                                    │
│ 对话                + │                                    │
│ 🔔 通知             3 │                                    │
│ 第二轮实验为什么异常…  │                                    │
│ 10-15 14:02 · 6 条    │                                    │
│ 样本条件怎么确认…      │                                    │
│ 10-14 09:31 · 4 条    │                                    │
│                       │                                    │
│ 退出登录               │                                    │
└───────────────────────┴────────────────────────────────────┘
```

侧边栏自上而下分成三段：

* **项目下拉**：左上角显示当前项目名和「状态 · 阶段」，点开可以切换项目，也可以进「全部项目」或「新建项目」。
* **项目内导航**：概览、时间线、行动、设置。进入某个 Project 才出现，对话不在其中，它在侧边栏的下半段。
* **对话**：导航下方是当前 Project 的会话列表。置顶的一条是特殊会话「通知」——铃铛图标加未读数，点进去是当前 Project 的通知页，它不跟随列表滚动，始终可见；下面是普通会话（预览、时间与消息数），点哪一段就切到哪一段讨论，当前会话高亮，行尾的 `+` 开一段新对话。

通知按 Project 收窄：列表里这条只数当前 Project 的未读，点进去也只列这个 Project 的通知。会话和通知都属于当前 Project，不在 Project 里时这一段整体不显示；切换 Project 后会话列表和未读数跟着换成新 Project 的。

不要在侧边栏堆大量功能。

## 4.1 布局与滚动

页面内容在一屏宽度内完整展示，不出现横向滚动；内容超出一屏高度时使用页面纵向滚动。侧边栏在桌面端吸在视口左侧，页面滚动时保持可见，侧边栏内容过长时自己滚动；会话列表是侧边栏里唯一会不断变长的一段，它自己滚动，品牌、项目下拉、导航、置顶的「通知」和退出登录始终可见。窄屏（900px 以下）退化为顶部栏，不吸边，也不显示会话列表。承载长文本的网格列必须限制最小宽度（`min-width: 0`）并允许换行，长字符串不得撑破容器。

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

最近发生的事来自 Agent 的产出，本身带着 Markdown 格式，所以概览里的近期动态和对话回复一样按 Markdown 渲染（标题、列表、代码块、表格可用，原始 HTML 一律转义），卡片有高度上限，超出时在卡片内部滚动。

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

这三样在概览页上都摊开给用户看：阶段跟在现状后面，开放问题和「智能体建议」并排，风险和未知项紧跟在下面一排；状态里没有内容的卡片不显示，不留空位。这四张卡片各有高度上限，内容超出时在卡片内部滚动，并排的两张不会互相拉高。

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

Chat 页采用对话与思考分离的两栏布局：左侧是研究讨论（一屏高的聊天室，输入框常驻底部），右侧是“思考结果”面板，每段对话关联自己的思考结果。整页和行动、时间线等页面共用同一个内容容器，宽度和左右留白一致，不会拉满整个内容区。历史对话列表不在这里，它常驻侧边栏（见第 4 节），所以在概览、时间线这些页面也能直接换一段讨论。窄屏（900px 以下，侧边栏退化成顶部栏）时侧边栏不显示会话列表，历史对话改为对话区顶部的横向标签行，“新对话”按钮和会话列表里那条特殊会话“通知”（带未读数）也移到这一行，思考结果排在对话下方。每轮问答结束后，系统自动把这段会话的全部问答记录作为一条 Observation 交给智能体思考；思考坚持宁缺毋滥，没有新信息的讨论不产出事件、提案、行动或建议。有产出时，判断、待确认状态变更、新事件、行动提议和建议显示在右侧，并且可以在右侧直接应用、确认或拒绝，不需要跳去概览页；这些内容一律写得短——判断一句话，事件、行动、建议只留标题和一句话说明，让人一眼看完这轮思考为什么发生、产出了什么，长度要求由 Engine 的 system prompt 保证。对话回复不等思考完成，思考在后台异步进行。AI 回复按 Markdown 渲染（全宽排版，标题、列表、代码块、表格可用，原始 HTML 一律转义），用户消息为右侧气泡；输入区是圆角容器，发送按钮内嵌在右下角。

当前会话由 URL 的 `?session=` 决定，全站只有这一条约定：带 `session` 参数就打开那一段对话，不带参数就是一段空白的新对话。侧边栏的“对话”默认指向最近一段会话，从侧边栏进入时接着上次聊；点“新对话”落到不带参数的 `/chat`，则是重新开始。发送第一条消息后 URL 自动补上 `session` 参数，刷新页面、浏览器回退、从其它页面点会话都落在同一段讨论上，右侧的思考结果跟着会话一起切换。

换一段会话时，对话和思考结果都先清空，用和真实内容形状一致的骨架屏占住两栏，等新数据到达再整体填入，消息区直接落在最新一条，不做从顶部滑到底部的长动画；上一段的内容留在屏幕上会被当成这一段讨论的内容。发送消息之后的重新加载不闪骨架，对话留在原地等新内容替换，思考结果同样保留到新结果返回。

从资料页带 `?doc=` 进入时，默认开新对话而不是选最新会话；输入区上方显示资料 pin（资料名，可关闭、可跳回资料页），随每条消息把 `document_id` 发给后端。切到别的会话时 URL 里的 `doc` 随之消失，pin 自动摘掉：资料上下文只属于从资料页开始的那段讨论。

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

## 14.1 资料详情页（kind=document）

资料详情页在通用 Action Detail 骨架（头部、来源、执行历史、智能体分析）之外，是资料的工作台。进行中时是录入形态：

```text
┌──────────────────────────────────────────┐
│ 整理实验报告资料        [资料][高][进行中][去对话] │
├──────────────────────────────────────────┤
│ 文档                                       │
│ [上传文件]  [粘贴文件直链 …][导入链接]         │
│ · 实验记录.docx   本机 · 12 KB · 已解析 428 字 [预览][删] │
│ · 报告.pdf       链接 · 1.2 MB · 不支持解析 [预览][新窗口打开] │
├───────────────────────────┬──────────────┤
│ 资料内容        [AI 整理]  │ 执行历史       │
│ 结论 ________________     │              │
│ 要点 ________________     │ 智能体分析     │
│ 内容 ________________     │              │
│ [完成并交给智能体][失败][取消] │              │
└───────────────────────────┴──────────────┘
```

结束后切换成阅读形态，宽栏读结果，窄栏只留时间线：

```text
├───────────────────────────┬──────────────┤
│ 整理结果                   │ 执行历史       │
│ 本次提供的资料并非论文…——  │ 10-14 22:18   │
│                           │   [已完成]     │
│ 要点                       │              │
│ · 目标:6 个月内从约 1000 词… │              │
│ · 路线图分四阶段:…          │              │
│                           │              │
│ 内容                       │              │
│ 一、资料范围…              │              │
│ 二、第二轮实验相关情况…      │              │
└───────────────────────────┴──────────────┘
```

交互约定：

- **上传与导入**：支持本机多选上传和粘贴文件直链导入，两者并列在文档卡顶部。文档列表显示名称、来源（本机/链接）、大小与解析状态（已解析带字符数、不支持解析、解析失败）；解析状态是徽标，失败原因放在 title 里。
- **预览**：预览使用 Open File Viewer，在居中的大号 Modal 中打开。本机来源先经带鉴权的接口拉取字节再交给预览组件；链接来源直接预览原 URL，并保留“新窗口打开”入口（目标站点不允许跨域读取时以此兜底）。预览组件按需加载，不进入首屏包。
- **对话**：头部「去对话」跳到 Chat 页并携带 `?doc=`，对话把资料文本作为上下文；Chat 页输入区上方显示资料 pin（可关闭、可跳回资料页），切换历史会话自动摘掉 pin。
- **整理**：整理表单（结论/要点/内容）支持手工填写，「AI 整理」基于文档文本生成草稿填进表单并提示检查修订；整理不落库、不触发思考，只有点「完成并交给智能体」才走 complete 提交。
- **结果与历史**：行动结束后，宽栏的卡片从表单切换成只读结果（结论一段话、要点列表、内容按原文分段），卡片标题也从「资料内容」变成「整理结果」；结构化结果只在这一处展示，右侧「执行历史」相应收成时间线（时间 + 状态，失败时带原因），不重复渲染同一份内容。这样的排布是因为资料行动的整理结果往往很长，塞进窄栏历史卡里既难读又会把主内容挤成空白。
- **生命周期**：行动结束后文档定稿——列表仍可见、仍可预览，但上传、导入、删除和整理按钮都隐藏。待确认（`proposed`）的行动显示等待确认的提示，确认入口在行动列表页。

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

时间线里的标题和正文也来自 Agent 的产出，本身带着 Markdown 格式，所以和概览的近期动态一样按 Markdown 渲染；正文仍比标题小一号、用次要颜色，保持标题与详情的层次。

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

通知页按 Project 组织，地址是 `/projects/{id}/notifications`，入口就是侧边栏会话列表里置顶的那条特殊会话（见第 4 节）。页面只列当前 Project 的通知，每条是一张卡片：severity 徽标、标题、正文和时间，未读的卡片底色更实并带「已读」按钮；页头的「全部已读」清掉这个 Project 的全部未读，别的 Project 不受影响。通知页和侧边栏那条入口共用同一份数据，标记已读之后侧边栏的未读数立刻跟着变。

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

- 2026-10-15：第 15 节补充时间线的渲染：标题和正文和概览的近期动态一样按 Markdown 渲染，正文仍比标题小一号、用次要颜色。
- 2026-10-15：第 7、8 节补充概览页的展示细节：阶段跟在现状后面，开放问题和智能体建议并排，风险、未知项紧跟在下面一排，没有内容的卡片不显示；开放问题、智能体建议、风险、未知项和近期动态都有高度上限，超出时卡片内部滚动，并排的卡片不互相拉高；近期动态本身是 Markdown，按 Markdown 渲染。
- 2026-10-15：第 11 节补充换会话时的加载约定：对话和思考结果先清空再加载，两栏显示骨架屏，消息区直接落在最新一条；发送消息后的重新加载不闪骨架、保留原内容。
- 2026-10-15：第 11 节补充思考结果的长度要求：判断一句话，事件、行动、建议只留标题和一句话说明，读一屏就能知道这轮思考为什么发生、产出了什么。
- 2026-10-15：通知从侧边栏的独立入口改成会话列表里置顶的一条特殊会话，侧边栏由四段收成三段；通知按 Project 收窄，页面地址改为 `/projects/{id}/notifications`，窄屏标签行也补上这条入口（第 4、11、24 节）。
- 2026-10-15：第 4 节改为侧边栏工作台布局：项目切换变成左上角的下拉选择器，导航下方常驻当前 Project 的会话列表；第 11 节的对话页改为对话与思考结果两栏，内容宽度收进和其它页面同一个容器，当前会话由 URL 的 `?session=` 决定。
- 2026-10-15：14.1 补充行动结束后的结果与历史排布：宽栏展示只读结果，执行历史收成时间线，结构化结果不再重复渲染。
- 2026-10-14：新增 14.1 资料详情页设计（文档上传/URL 导入、Open File Viewer 预览、去对话、AI 整理）；第 11 节补充资料 pin 与 `?doc=` 进入约定。
- 2026-10-13：第 11 节补充多会话（左侧历史对话列表、新建对话、窄屏标签行）、AI 回复 Markdown 渲染与输入区一体化（发送按钮内嵌右下角）的布局约定。
- 2026-10-12：第 11 节更新 Chat 为对话与思考分离的双栏布局：左侧研究讨论，右侧展示并可直接确认思考结果。
- 2026-10-12：第 4 节新增 4.1 与 4.2，约定一屏宽度展示与纵向滚动、侧边栏吸边、页面过渡动效、加载骨架与空态条件。
- 2026-10-12：移除会议详情页按需同步腾讯会议内容的交互设计，会议记录回归手工填写。
