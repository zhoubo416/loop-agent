#!/bin/sh
# 单容器同时运行 API 与前端:任一进程退出,容器整体退出,交给 Docker 的重启策略拉起
cd /app/apps/api || exit 1
node --import tsx src/index.ts &
api_pid=$!

cd /app/apps/web || exit 1
node .output/server/index.mjs &
web_pid=$!

shutdown() {
  kill -TERM "$api_pid" "$web_pid" 2>/dev/null || true
}
trap shutdown INT TERM

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done

# 有进程退出了:停掉另一个,两个都正常退出才算成功
shutdown
wait "$api_pid" 2>/dev/null
api_status=$?
wait "$web_pid" 2>/dev/null
web_status=$?
if [ "$api_status" -eq 0 ] && [ "$web_status" -eq 0 ]; then
  exit 0
fi
exit 1