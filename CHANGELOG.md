# 变更记录

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.1.0] - 未发布

首个可用版本的目标：本地 Git 只读工作台 + 写操作 + 审批策略（对应 docs/04 的 M0–M2）。

### 新增

- **monorepo 脚手架**：pnpm workspace + tsdown 统一构建（`lib/index.js` + `lib/index.d.ts`）、vitest、GitHub Actions（Linux/Windows × Node 22）。
- **`dsh-git-core`**：`GitService` / `GitHubService` 抽象、全部领域类型、`GitError` 错误模型，以及 `ctx.gitRisk` 风险注册表。
- **`dsh-git-local`**：本地 git Provider。`spawn(git, argv, { shell: false })`、超时/取消/输出上限、`GIT_TERMINAL_PROMPT=0` 干净环境、`realpath` + 仓库内路径约束；status(porcelain v2)、diff(四目标)、log、show、blame、remotes，以及 stage/unstage/commit/branch/stash/worktree。
- **`dsh-git-github`**：GitHub Provider。纯 `fetch` + 零第三方依赖；超时、重试、ETag/TTL 缓存、限流解析、`redirect: 'error'`、消息脱敏；authStatus / resolveSlug / repoView / listPulls / getPull / pullDiff / createPull（默认 draft）/ listIssues / getIssue。
- **`dsh-git-tool-git`**：11 个工具（5 只读 + 6 写），注册即登记风险，`toolPrefix` 可避让重名，`enableWriteTools` 可一键收成只读。
- **`dsh-git-tool-github`**：8 个 `gh_*` 工具（7 只读 + 1 联网写），`gh_pr_create` 默认 draft。
- **`dsh-git-client`**：host 侧只读 RPC（`POST /api/dsh-git/<op>`，op 白名单 `snapshot` / `branches` / `worktrees` / `pr`，写 op 返回 501）+ 右侧边栏 Git tab（`window.__ModuleLoader__` classic script，只 require `react` 与 `react/jsx-runtime`）。
- **`dsh-git-policy`**：`tools/pre-execute` 闸门，只作用于 `ctx.gitRisk` 里登记过的工具；`read/write/network-write` 三档默认 `allow/ask/deny`。
- **`dsh-git`（bundle）**：`cordis.patch.yml` 组合全部 7 行插件（core / local / policy / tool-git / github / tool-github / client），没有 `disabled` 占位。
- **验证**：94 个单元/集成测试（真实临时仓库、假 fetch 的 GitHub 客户端与服务、真实 HTTP 的 RPC、`vm` 沙箱里的客户端 bundle、schema 校验），以及不启动 GUI 的 `pnpm smoke` 冒烟脚本（19 个工具）。

### 尚未实现

- 网络类 git 工具 `git_fetch` / `git_pull` / `git_push`：`GitService` 未提供对应方法，`enableNetwork` 保持 `false`。
- 超限输出落盘（`DiffResult.spillPath` 暂为 `undefined`，只返回 `truncated`）。
- `gh_pr_create` 默认被策略拒绝（`network-write: deny`），需要在配置里改成 `ask` 才会真正请求审批。
- 面板只读：写操作需要 agent 级审批入口（ADR-020）。
- 发布动作本身（`pnpm publish` + 干净 profile 回归）见 [docs/09-发布清单.md](docs/09-发布清单.md)，尚未执行。
