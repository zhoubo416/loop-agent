# LOOP

一个项目,就是一个 Agent。

LOOP 里每个 Project 背后都跑着一个长期存在的 Agent:它持续观察项目的变化、理解当前状态、判断并执行下一步行动,再根据执行结果继续循环。多人可以共同参与同一个 Project 和这个 Agent。

```text
apps/api     后端 API 与 Agent Runtime(Node 20+ / TypeScript / Fastify)
apps/web     前端控制台(Nuxt 4 + Nuxt UI)
docs/design  设计文档,入口见 docs/design/README.md
docs/memory  开发过程中积累的经验和约定,索引见 AGENTS.md
```

## 环境要求

- Node 20 及以上(开发环境使用 Node 24),npm
- 本地开发不需要安装数据库:不配置 `DATABASE_URL` 时使用内嵌 PGlite
- Docker 部署需要 Docker Engine 和 Docker Compose v2

## 本地开发与调试

### 1. 安装依赖

```sh
npm run install:all
```

这条命令分别在 `apps/api` 和 `apps/web` 里执行 `npm install`。国内网络下安装超时的话,先给 npm 配置镜像源:

```sh
npm config set registry https://registry.npmmirror.com
```

### 2. 配置环境变量(可选)

后端启动时会自动加载仓库根目录的 `.env`,不创建也能跑。常用配置:

```sh
# 真实 PostgreSQL(可选;不配则使用内嵌 PGlite,数据落在 .data/pglite)
DATABASE_URL=postgres://user:password@localhost:5432/loop

# Agent 服务,走 OpenAI 兼容的 Chat Completions 协议
AGENT_ENGINE_BASE_URL=https://your-agent-service/v1
AGENT_ENGINE_API_KEY=your-key
AGENT_ENGINE_MODEL=your-model
```

`.env` 已在 Git 忽略规则里,不要把密钥提交进仓库。

### 3. 启动

开两个终端分别启动:

```sh
npm run api:dev    # 后端,http://127.0.0.1:4000
npm run web:dev    # 前端,http://127.0.0.1:3000
```

浏览器打开 http://127.0.0.1:3000。开发环境下没有登录时,前端会自动获取开发用户(`dev@loop.local`)的身份并带上,不需要手动登录。数据库 migration 在后端启动时自动执行;项目里没有假数据脚本,建 Project、发消息这些数据操作直接在界面上真实地做。

### 4. 日常调试

- 后端带 `--watch`,改代码自动重启;前端是 Nuxt 热更新,改动即时生效。
- 看数据库和 Agent 服务的连通状态:

  ```sh
  curl http://127.0.0.1:4000/health
  ```

  返回里 `database` 是当前使用的数据库,`agent_engine.ok` 是 Agent 服务连通状态;后端启动日志也会打印 Engine 名称和地址。
- 手动执行 migration(一般不需要,启动时已自动执行):

  ```sh
  npm run api:migrate
  ```

- 想要一份干净的本地数据,删掉 `.data/pglite` 目录再重启后端即可。
- 业务接口都要求身份。开发环境走自动 dev-login;要验证多用户数据隔离,先建用户,再用 `X-User-Id` 请求头指定身份调用接口。

### 5. 验证

提交或联调前,按改动范围运行相应检查:

```sh
npm run api:typecheck    # 后端类型检查
npm run api:test         # 后端端到端测试,使用独立的测试数据库,不会碰正式数据
npm run web:build        # 前端构建校验
```

默认测试里 Agent 输出由测试目录内的引擎替身提供,不真实调用 Agent 服务;需要验证真实 Engine 连通时:

```sh
LOOP_REAL_ENGINE_TEST=1 npm run api:test
```

## Docker 部署

单容器同时运行前端(3000)和 API(4000),数据默认落在 Docker 卷里,不接外部数据库也能直接用。

### 1. 构建并启动

```sh
docker compose up -d --build
```

构建会安装依赖并执行 `nuxt build`,第一次需要几分钟。启动后:

- 前端: http://127.0.0.1:3000
- API: http://127.0.0.1:4000,浏览器直连,两个端口都要能访问到

生产模式下开发登录接口已关闭,首次使用在前端登录页注册账号,之后用邮箱密码登录。

### 2. 配置

compose 会自动读取仓库根目录 `.env` 里的 `AGENT_ENGINE_*` 配置,与本地开发共用一份。其余配置都在 `docker-compose.yml` 的 environment 里改:

| 环境变量 | 说明 |
| --- | --- |
| `NUXT_PUBLIC_API_BASE` | 浏览器访问 API 的地址。默认 `http://127.0.0.1:4000/api/v1` 只适合浏览器和容器在同一台机器;部署到服务器、从其他设备访问时必须改成 `http://<服务器IP或域名>:4000/api/v1` |
| `AGENT_ENGINE_BASE_URL` / `AGENT_ENGINE_API_KEY` / `AGENT_ENGINE_MODEL` | Agent 服务配置,从根目录 `.env` 读取 |
| `DATABASE_URL` | 默认不配,使用容器内嵌 PGlite。要接外部 PostgreSQL 时在 compose 里显式配置,文件里有注释示例。注意 compose 不会透传 `.env` 里的 `DATABASE_URL`:那是本地开发机器上的库,容器大概率访问不到 |
| `TENCENT_MEETING_TOKEN_ENCRYPTION_KEY` | 使用腾讯会议导入功能时需要 |

### 3. 数据

数据库和上传文件都落在 `loop-data` 卷(`/app/.data`),`docker compose down` 不会删掉它。换外部 PostgreSQL 时在 compose 里配好 `DATABASE_URL` 重启即可,migration 在服务启动时自动执行。

### 4. 日常运维

```sh
docker compose logs -f               # 看日志,API 启动时会打印 Engine 名称和地址
curl http://127.0.0.1:4000/health    # 健康检查,看数据库和 Agent 服务状态
docker compose up -d --build         # 更新代码后重新部署
docker compose down                  # 停止并删除容器,数据卷保留
```

容器里任一进程退出,整个容器会退出并由 `restart: unless-stopped` 自动拉起。

### 常见问题

- 页面能打开但对话没反应:看 `/health` 里 `agent_engine.ok` 是否为 `false`,多半是没配 `AGENT_ENGINE_API_KEY` 或 Agent 服务地址不通。
- 本机访问正常,其他设备打不开 API:改 `NUXT_PUBLIC_API_BASE`,原因见上面的配置表。
- 海外服务器构建很慢或失败:取消 `docker-compose.yml` 里 `build.args` 的注释,改用 npm 官方源。

## 更多文档

- 设计文档: `docs/design/README.md`,包含产品与架构、数据库、Agent Runtime、API、前端和 MVP 计划等
- 开发与部署经验: 见 `AGENTS.md` 的 Memory 索引,部署细节在 `docs/memory/deployment.md`,本地环境细节在 `docs/memory/local-development.md`