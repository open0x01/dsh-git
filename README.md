# dsh-git

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Git / GitHub 插件套件：把 GitHub 上分散的 DSH Git 相关插件能力，收敛成一套统一契约、零外部二进制依赖、默认安全的实现。

> **当前状态：功能已全部落地**（可构建、可测试、可加载；npm 发布待执行）。
> 本地 Git 11 个工具、GitHub 8 个工具、审批策略、bundle 与右侧边栏面板（只读）都已就位。

## 它解决什么问题

社区已有多个 DSH Git / GitHub 插件，但：

- 工具名互相冲突（`git_status`、`git_diff`、`git_commit` 至少被 3 个插件同时占用）；
- 做 UI 的不给模型工具，做工具的不给 UI，两边语义不一致；
- 覆盖最广的方案强依赖 `gh` CLI 与 `gh auth login`；
- 部分插件在 `tools/pre-execute` 里按文本拦截命令，对其他插件误伤。

`dsh-git` 用 DSH 官方的三层能力模型把这件事重新做一遍：**UI 与模型工具调用同一个 `ctx.git` / `ctx.github`**，审批与凭据只有一套。

## 能力（v0.1）

**本地 Git（11 个工具，已全部注册）**

| 只读 | 写（走审批） |
|---|---|
| `git_status`、`git_diff`、`git_log`、`git_show`、`git_blame` | `git_stage`、`git_unstage`、`git_commit`、`git_branch`、`git_stash`、`git_worktree` |

`git_fetch` / `git_pull` / `git_push` 默认**不注册**（`enableNetwork: false`，且 Provider 尚未提供网络方法）。

**GitHub（8 个工具，已全部注册）**

| 只读 | 联网写（默认 deny） |
|---|---|
| `gh_auth_status`、`gh_repo_view`、`gh_pr_list`、`gh_pr_view`、`gh_pr_diff`、`gh_issue_list`、`gh_issue_view` | `gh_pr_create`（默认 draft） |

**Web 面板（只读）**

- 右侧边栏 **Git** tab：分支与 ahead/behind、已暂存/未暂存/未跟踪三组文件、最近提交、刷新。
- host 侧 RPC：`POST /api/dsh-git/<op>`，op 白名单 `snapshot` / `branches` / `worktrees` / `pr`。
- **不提供写操作**：审批需要 agent 与进行中的 turn，HTTP 路由没有这个上下文；写操作请让模型调用工具（会走审批）。

## 设计红线

1. **不用 shell**：`execFile('git', argv)`，永不拼接字符串。
2. **凭据只有引用**：配置里只有 `GITHUB_TOKEN` 这样的名字，值由 `ctx.credentials` 逐操作解析，不落盘、不进日志、不进会话。
3. **危险操作没有入口**：不提供 `reset --hard` / `clean -fd` / `checkout -- .` 的工具，而不是「提供了再拦」。

## 目录

```text
dsh-git/
├─ packages/                  # 8 个包
│  ├─ core/        dsh-git-core         服务定义 + ctx.gitRisk
│  ├─ local/       dsh-git-local        本地 git Provider（spawn argv）
│  ├─ github/      dsh-git-github       GitHub Provider（REST + fetch）
│  ├─ tool-git/    dsh-git-tool-git     本地 git 工具（11 个）
│  ├─ tool-github/ dsh-git-tool-github  GitHub 工具（8 个 gh_*）
│  ├─ policy/      dsh-git-policy       风险表 + tools/pre-execute 策略
│  ├─ client/      dsh-git-client       Web 侧边栏面板（只读）
│  └─ bundle/      dsh-git              bundle：cordis.patch.yml
├─ examples/cordis.dev.yml    # 本地 --patch 调试 overlay
├─ scripts/smoke.mjs          # 不起 GUI 的加载冒烟
└─ .github/workflows/ci.yml   # typecheck / build / test / smoke
```

## 本地验证

```powershell
pnpm install
pnpm typecheck      # 8 个包的类型检查
pnpm build          # tsdown → 每包 lib/index.js + lib/index.d.ts（client 另产 lib/client.js）
pnpm test           # 94 个测试（真实临时仓库集成 + 假 fetch 的 GitHub 客户端 + 客户端 bundle 沙箱）
pnpm smoke          # 挂到真实 cordis Context，断言 ctx.git / ctx.github / 19 个工具
pnpm verify         # 以上四步串起来
```

把本地代码插进任意 profile（不需要打包）：

```powershell
dsh --profile web --patch <仓库路径>/examples/cordis.dev.yml --dump-config
```

`--dump-config` 里能看到 `dsh-git-core` / `dsh-git-local` / `dsh-git-policy` / `dsh-git-tool-git` / `dsh-git-github` / `dsh-git-tool-github` 六行，
且 `name` 已被解析成 `file:///…/packages/<pkg>/lib/index.js`。

> 浏览器里的面板（`lib/client.js`）由 dsh-client-modules 按**包名**解析，只有真正装进 profile 才会加载；`--patch` 只覆盖 host 行。

## 安装（发布后）

```powershell
dsh plugin --profile <name> add dsh-git
dsh --profile <name> --dump-config | Select-String dsh-git
```

## 本地调试（装进独立 profile，含面板）

```powershell
pwsh -File scripts/install-local.ps1      # 构建 + 准备安装树 + 写进 profile gitdev
dsh --profile gitdev                      # 启动 Web UI（会打印端口）
```

为什么不能直接 `dsh plugin add <仓库目录>`：包间依赖是 `workspace:^`（profile 不是 pnpm workspace），且 pnpm 会把本地目录装成 `link:`，链接目标解析不到宿主的 `@deepseek-ai/*`。
脚本用「平铺 node_modules + 目录联接」绕开：`@deepseek-ai` 直接指向 dsh 自带的那一份，保证全进程只有一份 cordis。

改代码后：`pnpm build` 再重跑脚本（profile 不用重建）；客户端 `lib/client.js` 有 500ms 轮询，改完浏览器会自动重载该模块。

卸载：`dsh plugin --profile gitdev remove dsh-git`，或直接删掉 `\/profiles/gitdev` 与安装树目录。

## 环境基线

| 组件 | 本机验证版本 | 说明 |
|---|---|---|
| dsh | 0.2.1-rc.2 | 插件 API 以该版本为准 |
| Node.js | v24.15.0 | `engines: >=22` |
| pnpm | 11.22.0 | `packageManager` 固定 |
| git | 2.54.0.windows.1 | ≥ 2.26（worktree） |

## 与生态的关系

`dsh-git` 不修改任何现有插件，也不要求卸载它们。与其他 Git 插件同装时：

- 工具重名会在加载期**同步报错**（DSH 的工具注册表不允许静默覆盖）；
- 用 `dsh-git-tool-git.toolPrefix`（例如 `dshgit_`）或 `dsh-git-tool-github.toolPrefix` 给工具名加前缀即可避让；
- 我们的审批策略只作用于自己注册的工具，不会拦截其他插件的命令。

## 许可证

[MIT](LICENSE)。
