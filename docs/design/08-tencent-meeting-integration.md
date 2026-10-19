# 腾讯会议集成

## 1. 文档目的

本文记录 LOOP 接入腾讯会议 MCP 的方式、个人账号绑定、会议内容导入流程和限制。

会议类型的 Action 可以直接从腾讯会议导入纪要、参会人和逐字稿，减少手工录入；导入只填充表单，是否完成、交给智能体什么内容，仍由用户确认。逐字稿只保存在 LOOP 的导入快照里，不进入 Agent Observation。

---

## 2. 外部能力

### 2.1 MCP 端点与鉴权

```text
https://mcp.meeting.tencent.com/mcp/wemeet-open/v1
```

- 旧的根地址 `https://mcp.meeting.tencent.com` 已返回 404，配置里的根地址会被自动补成上面的完整端点。
- 请求方式：JSON-RPC 2.0 POST，直接调用 `tools/call`，不需要本地代理或 initialize。
- 请求头：

```text
X-Tencent-Meeting-Token: <个人 Token>
X-Skill-Version: 1.0.15
content-type: application/json
accept: application/json, text/event-stream
```

- 每个工具调用的 `arguments` 都要带 `_client_info`，包含 `os`、`agent`、`model`。
- 个人 Token 从 `https://meeting.tencent.com/ai-skill` 用个人账号登录后复制，长期有效；主动重置后旧 Token 立即失效。
- 个人版、专业版可用；企业版/商业版需要腾讯灰度申请，官方建议改用 OpenAPI。

### 2.2 工具

与导入相关的只读工具：

| 工具 | 用途 |
|---|---|
| `get_user_ended_meetings` | 按时间范围分页查已结束会议 |
| `get_meeting` / `get_meeting_by_code` | 会议详情 |
| `get_meeting_participants` | 实际参会人 |
| `get_minutes` | 元宝纪要，支持 overview / summary_points / todos |
| `get_smart_minutes` | 录制对应的智能纪要 |
| `get_records_list` | 录制文件列表 |
| `get_transcripts_paragraphs` | 转写段落，返回 `pids` |
| `get_transcripts_details` | 按 `record_file_id` + `pid` 取逐字稿详情 |

只使用只读能力，不调用创建、修改、取消会议，也不写回腾讯会议。

### 2.3 返回结构与错误

JSON-RPC 的成功响应把业务数据放在 `result.content[0].text`（JSON 字符串）里，常见形态：

```json
{
  "data": {
    "status_code": 200,
    "body": "{\"meeting_info_list\":[...]}"
  }
}
```

业务错误不会设置 `isError`，HTTP 仍是 200，错误包在 `data.body` 里：

```json
{
  "data": {
    "status_code": 500,
    "body": "{\"error\":\"type:business, code:-1, msg:token not found\"}"
  }
}
```

客户端会依次拆 JSON-RPC、`result.content[0].text`、`data.status_code` / `data.body`，再判断业务错误。

几个容易读错的结构：

- `get_meeting` / `get_meeting_by_code` 的业务数据是 `meeting_info_list` 数组，不是单个 `meeting` 对象；详情里的 `records` 是整条系列会议的录制文件，周期会议要按选中实例的起止时间筛选。
- `get_smart_minutes` 的正文和待办在 `meeting_minute` 里；逐字稿段落的说话人放在 `speaker.user_name`。
- `get_records_list` 可能返回空列表，即使会议详情里带着录制；导入时要用详情里的 `records` 兜底。
- 业务错误也可能放在 `error_info` 里，例如 `{"error_info":{"error_code":9042,"message":"无权限操作"}}`。

### 2.4 限制

- AI 只能读取 Token 所属账号下的会议。
- 纪要、智能纪要和逐字稿依赖主持人开启云录制，会议结束后录制还需要处理 5–30 分钟。
- 录制权限默认归会议创建者，其他参会人需要在腾讯会议 App 里申请。
- 元宝纪要可能独立于录制存在，因此优先查纪要，再查录制兜底。
- 一个 Token 只对应一个账号；切换账号需要重新绑定。

### 2.5 OAuth 扫码为什么不采用

MCP 网关确实提供了 OAuth 元数据和授权页（PKCE、`work.medialab.qq.com`），但第三方动态注册被拒（实测返回 `client_name or redirect_uris not registered`）。官方 CLI 的扫码设备码流程属于另一套 OpenAPI 授权，依赖非公开接口，不适合第三方直接复用。

当前稳定可行的是个人 Token。扫码只用于引导用户打开腾讯会议官方 AI Skill 页面完成登录，Token 由用户复制一次。

---

## 3. 产品流程

### 3.1 绑定

- Token 按用户独立存储，一个用户一条。
- 绑定入口有两个：
  - 项目设置页的「腾讯会议（当前账号）」卡片，可查看绑定状态、重新绑定、解除绑定；
  - 会议详情页的导入弹窗，未绑定时直接展示绑定表单。
- 绑定前会真实调用一次 `get_user_ended_meetings` 验证 Token；验证失败不落库。
- 服务端只保存 AES-256-GCM 密文和 Token 末 4 位的掩码，原始 Token 永远不返回浏览器。

### 3.2 导入

```text
会议 Action（pending / running）
  └─ 从腾讯会议导入
       ├─ 选择时间范围（默认近 7 天，最多 31 天）
       ├─ 列出已结束会议
       ├─ 读取内容并保存快照
       ├─ 预览结论、纪要、参会人、逐字稿
       └─ 导入到会议记录 → 填充表单
```

- 读取内容时就把快照写入 `action_meeting_imports`；用户如果只读不填，快照仍然保留，页面提供「用这份内容填充表单」。
- 表单回填规则：
  - 结论 ← `summary`（元宝纪要的 overview，或智能纪要正文里的「会议摘要」）
  - 参会人 ← `participants`
  - 纪要 ← 纪要正文；元宝纪要的待办会在正文末尾补成「待办事项」，智能纪要正文本身已经带待办
  - 不再单独设置「决定」「后续行动」字段，这两部分的内容本来就在纪要正文里，随纪要一起交给智能体
  - 每次填充只覆盖有数据的字段，快照里没有的内容不清空用户已经填好的值
- 逐字稿只保存在快照里，页面上可展开查看，不写入完成时提交的 `output`。

### 3.3 完成

用户检查表单后点「完成并交给智能体」，走现有 `completeAction`：生成 Execution、Observation 和新的 Agent Run。Observation 里带结论、参与人和纪要，决定和后续行动的内容在纪要里，不带逐字稿。

会议结束后详情页隐藏表单，但保留只读的导入内容卡片，仍然可以展开逐字稿。

---

## 4. 数据库

两张表，详细字段见 `docs/design/02-database-design.md` 第 42 节：

- `user_integrations`：用户级第三方凭证，当前只支持 `provider=tencent_meeting`。
- `action_meeting_imports`：每个会议 Action 最近一次导入的原始内容，按 `action_id` 唯一，重复导入覆盖。

---

## 5. 后端

### 5.1 代码结构

```text
src/integrations/tencent-meeting.ts         MCP 客户端、响应拆包、归一化解析
src/integrations/tencent-meeting-import.ts  读取一场会议并保存快照
src/modules/integrations.ts                 Token 加密存取、掩码、状态
src/modules/meeting-imports.ts              导入快照读写
src/http/routes/integrations.ts             绑定、解绑、状态、会议列表
```

### 5.2 接口

```text
GET    /api/v1/me/integrations/tencent-meeting
PUT    /api/v1/me/integrations/tencent-meeting
DELETE /api/v1/me/integrations/tencent-meeting
GET    /api/v1/me/integrations/tencent-meeting/meetings
POST   /api/v1/projects/{project_id}/actions/{action_id}/meeting-import
```

- `GET` 返回 `{ configured, masked_token, updated_at }`。
- `PUT` 接收 `{ token }`，验证成功后保存。
- `GET meetings` 接收 `from`、`to`、`page_token`，返回归一化的 `items` 和分页字段。
- `meeting-import` 接收 `meeting_id` 或 `meeting_code`，可带 `sub_meeting_id`、`started_at`、`ended_at`；后两个是列表里选中那一场会议的时间，周期会议靠它们定位具体实例。只允许 `kind=meeting` 且状态为 `pending` / `running`。
- Action 详情响应增加 `meeting_import`，没有时是 `null`。快照包含 `summary`（会议结论）、`participants`、`minutes`、`todos`、`transcript` 和 `transcript_segments`。

### 5.3 内容获取顺序

1. `get_meeting` / `get_meeting_by_code` 定位会议（响应里的 `meeting_info_list` 取第一条）；
2. `get_meeting_participants` 取参会人（失败不阻断），周期会议传列表里的 `sub_meeting_id`；参会人明细只对会议创建者开放，非创建者拿到 9042 无权限时，先从纪要正文的「发言人：」一行提取，还没有就从逐字稿各段落的发言人收集；
3. `get_minutes` 取元宝纪要，结论取 `overview`；
4. 纪要为空时找录制：先查 `get_records_list`，查不到时用会议详情里的 `records`，按选中实例的起止时间筛出对应的一条；再用 `get_smart_minutes` 兜底；
5. 有录制时，`get_transcripts_paragraphs` → `get_transcripts_details` 取逐字稿（失败不阻断）；
6. 纪要和逐字稿都没有时返回 `MEETING_CONTENT_NOT_FOUND`。

智能纪要的结论从正文里的「会议摘要：」一行提取；元宝纪要的待办会补到纪要正文末尾，智能纪要正文本身已经带待办。

只有 Token 失效会中止整次导入；权限不足、录制处理中等问题只影响对应内容。

### 5.4 错误映射

| 情况 | 对外错误 |
|---|---|
| 未绑定 Token | `INTEGRATION_NOT_CONFIGURED` |
| Token 失效 | `INTEGRATION_AUTH_FAILED` |
| 会议不存在 | `MEETING_NOT_FOUND` |
| 没有权限 / 没有纪要或录制 | `MEETING_CONTENT_NOT_FOUND` |
| MCP 超时、不可用、录制生成中 | `INTEGRATION_UNAVAILABLE` |
| 非会议 Action | `ACTION_KIND_MISMATCH` |
| Action 已结束 | `ACTION_INVALID_STATE` |

### 5.5 安全

- Token 使用 AES-256-GCM 加密，密钥只从环境变量 `TENCENT_MEETING_TOKEN_ENCRYPTION_KEY` 读取。
- 日志不记录 Token 和会议正文。
- 绑定、解绑、会议列表都按当前登录用户查询；导入还要求项目成员权限。
- 导入后的会议内容保存在 Action 快照里，属于项目数据，项目成员都能查看；Token 仍然只属于绑定它的用户。
- 只调用腾讯会议 MCP 的只读工具。

---

## 6. 前端

- `TencentMeetingBinding.vue`：绑定状态、Token 输入、保存验证、重新绑定、解除绑定；设置页和导入弹窗共用。
- `MeetingImportModal.vue`：时间范围、已结束会议列表、结论/参会人/纪要预览、逐字稿折叠、导入按钮。
- `MeetingImportSnapshotView.vue`：详情页展示导入快照；编辑态只显示来源和逐字稿，完成后展示结论、参会人和纪要。
- 会议详情页在编辑态提供「从腾讯会议导入」，表单只有结论、参会人、纪要三项；决定和后续行动不再单独填写，内容留在纪要里。
- 设置页新增「腾讯会议（当前账号）」卡片，显示掩码和绑定时间。
- 不生成应用内二维码，扫码登录由腾讯会议官方页面提供。

---

## 7. 关键取舍

- **先人工选择、再导入**：不做后台定时扫描，避免权限、去重和失败重试把首版拖复杂。
- **导入不等于完成**：AI 纪要可能还没生成完，内容也需要人核对，所以只填表，由用户确认完成。
- **逐字稿不进 Observation**：逐字稿很长，进上下文会挤占 Agent 的判断空间；它只作为可回看的原始资料保存在快照里。
- **纪要优先于录制**：元宝纪要可能不依赖录制，先查纪要能覆盖更多会议。
- **Token 原文不出服务端**：设置页只显示掩码，降低凭证泄露面。

---

## 修改历史

- 2026-10-19：参会人明细接口对非会议创建者返回无权限，导入改为先取纪要「发言人」一行、再取逐字稿发言人兜底（第 5.3 节）。
- 2026-10-19：会议表单改为只保留结论、参与人、纪要；结论从会议摘要提取，决定和后续行动不再单独填写，内容留在纪要正文里；填充只覆盖有数据的字段（第 3.2、3.3、5.3、6 节）。
- 2026-10-18：补充会议详情、智能纪要和逐字稿的真实返回结构；周期会议用选中实例的 `sub_meeting_id` 与起止时间定位，录制列表为空时用会议详情里的录制兜底（第 2.3、5.2、5.3 节）。
- 2026-10-18：新增腾讯会议 MCP 集成：个人 Token 绑定、已结束会议选择、纪要/参会人/逐字稿导入、逐字稿只存快照不进入 Agent Observation。
