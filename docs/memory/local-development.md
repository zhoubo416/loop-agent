# 本地开发环境

## 目录结构

```text
apps/api    后端 API 与 Agent Runtime(Node + TypeScript + Fastify)
apps/web    前端控制台(Nuxt 4 + Vue + Nuxt UI)
```

两个子项目各自安装依赖,根目录脚本只是转发:

```sh
npm run install:all        # 等价于分别在两个子项目执行 npm install
npm run api:dev            # 启动后端,默认 http://127.0.0.1:4000
npm run web:dev            # 启动前端,默认 http://127.0.0.1:3000
```

## 数据库

- 仓库根目录的 `.env` 提供 `DATABASE_URL`,后端启动时自动加载,使用真实的 PostgreSQL。托管数据库会回收空闲连接,连接池对**读**语句会重试一次,**写**语句不重试:写可能在服务端已经执行、只是响应没回来,重试会把同一条写再做一遍,留下重复数据(例如同一会话里两条一样的消息)。写失败就让这次请求失败,由用户重发,不要靠自动重试去救。
- 事务只在"提交之前"被连接中断时才整段重试:没提交的东西数据库会回滚,重来是安全的;`COMMIT` 已经发出去之后失败,无法判断到底提交没提交,不能重来。
- 启动时的 migration 与开发用户兜底整体是幂等的(建表带 `IF NOT EXISTS`,跑过的 migration 记在 `schema_migrations` 里),所以允许整体重试几次。改成写语句不重试之后,这两步要是不重试,托管数据库抖一下服务就直接起不来,而 `--watch` 模式下它只会一直等着文件变化,看起来就像服务莫名其妙不见了。
- 没有配置 `DATABASE_URL` 时会回落到内嵌 PGlite,数据落在仓库根目录的 `.data/pglite`(已加入 `.gitignore`),表结构和 migration 完全一致。
- Migration 在服务启动时自动执行,也可以手动运行 `npm run api:migrate`。
- 项目里没有任何示例数据生成脚本,需要数据就在界面上真实地创建 Project 和输入信息。
- 重新开始一份干净的本地数据,删除 `.data/pglite` 目录即可。

## Agent Engine

- 产品只连真实 Agent 服务,通过 `AGENT_ENGINE_BASE_URL`、`AGENT_ENGINE_API_KEY`、`AGENT_ENGINE_MODEL` 配置,走 OpenAI 兼容的 Chat Completions 协议。
- 服务启动时会打印 Engine 名称和地址,`GET /health` 可以看到 `agent_engine` 的连通状态。
- 真实 Engine 的连通性测试默认不跑,需要显式开启:`LOOP_REAL_ENGINE_TEST=1 npm run api:test`。它会真实调用一次 Agent 服务。

## 验证

```sh
npm run api:typecheck      # 后端类型检查
npm run api:test           # 后端端到端测试,使用独立的测试数据库
npm run web:build          # 前端构建校验
```

后端测试会强制使用独立的 PGlite 测试库,即使 `.env` 里配了 `DATABASE_URL` 也不会写到正式数据库上。测试里的 Agent 输出由测试目录内的引擎替身提供,保证断言可复现;产品代码不含任何 mock。

## 身份

- 业务接口都要求 `X-User-Id`,没有请求头会返回 401,不再回落到某个默认用户。
- 前端默认通过 `POST /api/v1/dev-login` 拿到开发用户 `dev@loop.local` 的身份并带上,这个接口只在开发环境开放(`NODE_ENV !== 'production'`)。
- 需要验证多用户隔离时,先建用户,再用 `X-User-Id` 指定身份调用接口;`GET /api/v1/users` 只返回和当前用户共同参与过 Project 的人。
- 正式使用走邮箱密码:`POST /api/v1/auth/register` 或 `POST /api/v1/auth/login` 返回 `token`,之后用 `Authorization: Bearer <token>` 携带身份。前端登录页会把它存进 cookie,退出即清除。

## 网络

- 国内网络下 npm 官方源可能超时,安装依赖统一加 `--registry=https://registry.npmmirror.com`。
