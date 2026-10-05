# 提交规范

- 提交之前先确保检查全部通过,运行与改动范围相称的 lint、format、typecheck 和测试脚本。
- 标题格式是 `<type>(<scope>): <简短中文描述>`;`type` 从 `feat` / `fix` / `refactor` / `perf` / `docs` / `test` / `chore` 里挑选一个。
- `scope` 标注改动所属范围,方便查阅 git log:
  - 代码落地后按子项目目录名约定 scope,例如 `api`、`runtime`、`web`。
  - 跨项目改动和流程性改动(文档规范、配置这类)不带 scope,简化成 `<type>: <描述>`。
- 除非改动特别简单,否则提交都要附带 body,用 `- ` 分条写清楚"改了什么、为什么"。
- 提交里不要附带 `Co-authored-by` 或其他 AI 署名。
- 提交粒度按完整功能来,不按操作步骤机械拆分。把一个功能做完并验证通过后,用一个 commit 完整记录;fixup 性质的小修补可以单独一个 commit。
- 功能分支或 worktree 分支合回目标长期分支时,默认使用 `git merge --no-ff <分支>`,保留独立开发提交和明确的 merge 记录。先同步并切换到目标分支,确认工作区干净后再创建 merge commit,归并后验证最终文件树和相关检查结果再推送。不要自行改用 rebase、squash 或快进归并;只有用户明确要求整理线性历史时才使用 rebase。
- 同步同一功能分支的远端更新(`git push` 被拒、远端有本地没有的提交)时,用 rebase 整合,不要产生 merge commit。先 `git fetch` 看分叉,再 `git rebase <远端最新提交>` 把本地提交重放到远端之上,最后 `git push --force-with-lease`。上面的 `merge --no-ff` 只用于合回目标长期分支,不用于同一分支的远端同步。
