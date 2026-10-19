# LOOP 单容器镜像:同时运行 API(4000)与前端(3000)
# 国内网络默认走 npmmirror,海外构建时用 --build-arg NPM_REGISTRY=https://registry.npmjs.org 覆盖
FROM node:24-alpine

ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# 先只复制依赖声明,lockfile 不变时这两层直接命中缓存,不重新安装
COPY apps/api/package.json apps/api/package-lock.json apps/api/
COPY apps/web/package.json apps/web/package-lock.json apps/web/

# --ignore-scripts:不执行任何第三方安装脚本,与依赖审查要求一致
# 被跳过的 nuxt prepare 只是类型生成,后面的 nuxt build 不依赖它
RUN npm --prefix apps/api ci --ignore-scripts --registry="$NPM_REGISTRY" \
 && npm --prefix apps/web ci --ignore-scripts --registry="$NPM_REGISTRY"

COPY apps/api apps/api
COPY apps/web apps/web
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/loop-entrypoint

# 安装依赖时不能带 production,否则会漏掉构建需要的开发依赖;运行时固定生产模式
# HOST 必须是 0.0.0.0,API 默认只监听 127.0.0.1,容器外将无法访问
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    NUXT_PUBLIC_API_BASE=http://127.0.0.1:4000/api/v1

RUN npm --prefix apps/web run build

EXPOSE 3000 4000

# PGlite 数据库与上传文件都落在 /app/.data,运行时记得挂卷
VOLUME /app/.data

CMD ["/usr/local/bin/loop-entrypoint"]