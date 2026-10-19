# Docker 部署

## 结构

- 单容器同时运行 API(4000)与前端(3000),入口脚本是 `docker/entrypoint.sh`:任一进程退出,容器整体退出,交给 `restart` 策略拉起。
- 浏览器直连 API,所以容器要开放两个端口。改对外端口时只改 compose 的 ports 映射,不要在容器里设 `PORT`:API 和 Nuxt 都会读它,一设两边一起挪。
- 前端访问 API 的地址由 `NUXT_PUBLIC_API_BASE` 决定。默认 `http://127.0.0.1:4000/api/v1` 只适合浏览器和容器在同一台机器;跨机器访问要改成 `http://<服务器IP或域名>:4000/api/v1`。
- 镜像里 `NODE_ENV=production`,dev-login 关闭,首次使用要在登录页注册账号。

## 构建约定

- 依赖安装用 `npm ci --ignore-scripts`,不执行任何第三方安装脚本,与"依赖管理与第三方执行代码审查"的要求一致。被跳过的 `nuxt prepare` 只是类型生成,`nuxt build` 不依赖它。
- 默认从 npmmirror 安装,海外网络构建时用 `--build-arg NPM_REGISTRY=https://registry.npmjs.org`(或取消 compose 里 build.args 的注释)。
- `AGENT_ENGINE_BASE_URL` 和 `AGENT_ENGINE_MODEL` 在 compose 里兜底了与代码一致的默认值:这两个配置读到空字符串时不会回落到代码默认值,直接透传空串会把请求发到错误地址。

## 数据

- 默认不配 `DATABASE_URL`,容器内使用内嵌 PGlite,数据库和上传文件都落在 `loop-data` 卷(`/app/.data`)。
- compose 特意不透传根目录 `.env` 的 `DATABASE_URL`:那是本地开发机器上的库,容器大概率访问不到,直接透传只会得到一个起不来或连错库的服务。要接外部 PostgreSQL,在 compose 的 environment 里显式配置;migration 在服务启动时自动执行。

## 常用命令

```sh
docker compose up -d --build        # 构建并启动
docker compose logs -f              # 看日志,API 启动时会打印 Engine 名称和地址
docker compose down                # 停止并删除容器,loop-data 卷保留
curl http://127.0.0.1:4000/health   # 健康检查,能看到数据库与 agent_engine 状态
```