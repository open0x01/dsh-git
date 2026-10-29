# 变更记录

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.1.0] - 未发布

首个可用版本的目标：本地 Git 只读工作台 + 写操作 + 审批策略（对应 docs/04 的 M0–M2）。

### 新增

- **monorepo 脚手架**：pnpm workspace + tsdown 统一构建（`lib/index.js` + `lib/index.d.ts`）、vitest、GitHub Actions（Linux/Windows × Node 22）。
- **`dsh-git-core`**：`GitService` / `GitHubService` 抽象、全部领域类型、`GitError` 错误模型，以及 `ctx.gitRisk` 风险注册表。
- **`dsh-git-local`**：本地 git Provider。`spawn(git, argv, { shell: false })`、超时/取消/输出上限、`GIT_TERMINAL_PROMPT=0` 干净环境、`realpath` + 仓库内路径约束；status(porcelain v2)、diff(四目标)、log、show、blame，以及 stage/unstage/commit/branch/stash/worktree。
- **`dsh-git-tool-git`**：5 个只读工具 `git_status` / `git_diff` / `git_log` / `git_show` / `git_blame`，注册即登记风险，`toolPrefix` 可避让重名。
- **`dsh-git-policy`**：`tools/pre-execute` 闸门，只作用于 `ctx.gitRisk` 里登记过的工具；`read/write/network-write` 三档默认 `allow/ask/deny`。
- **`dsh-git`（bundle）**：`cordis.patch.yml` 组合 4 行可用插件，另 3 行（github / tool-github / client）以 `disabled: true` 占位。
- **验证**：43 个单元/集成测试（含真实临时仓库上的 status/diff/log/show/blame/commit/stash/worktree），以及不启动 GUI 的 `pnpm smoke` 冒烟脚本。

### 尚未实现

- `dsh-git-github` / `dsh-git-tool-github`（M3）：GitHub REST Provider 与 8 个 `gh_*` 工具。
- `dsh-git-client`（M4）：Web 右侧边栏面板与 host 侧 RPC。
- 网络类 git 工具 `git_fetch` / `git_pull` / `git_push`：Provider 未提供对应方法，`enableNetwork` 保持 `false`。
- 超限输出落盘（`DiffResult.spillPath` 暂为 `undefined`，只返回 `truncated`）。
