# dsh-git

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Git / GitHub 插件套件：把 GitHub 上分散的 DSH Git 相关插件能力，收敛成一套统一契约、零外部二进制依赖、默认安全的实现。

> **当前状态：M0–M5 全部落地**（可构建、可测试、可加载；发布动作待执行）。
> 本地 Git 11 个工具、GitHub 8 个工具、审批策略、bundle 与右侧边栏面板（只读）都已就位。进度见 [docs/00-执行总览.md](docs/00-执行总览.md)，验证方式见 [docs/05-开发与运行手册.md](docs/05-开发与运行手册.md)，发版步骤见 [docs/09-发布清单.md](docs/09-发布清单.md)。

## 它解决什么问题

社区已有 7 个 DSH Git / GitHub 插件（[调研报告](docs/02-生态调研与能力矩阵.md)），但：

- 工具名互相冲突（`git_status`、`git_diff`、`git_commit` 至少被 3 个插件同时占用）；
- 做 UI 的不给模型工具，做工具的不给 UI，两边语义不一致；
- 覆盖最广的方案强依赖 `gh` CLI 与 `gh auth login`；
- 部分插件在 `tools/pre-execute` 里按文本拦截命令，对其他插件误伤。

`dsh-git` 用 DSH 官方的三层能力模型把这件事重新做一遍：**UI 与模型工具调用同一个 `ctx.git` / `ctx.github`**，审批与凭据只有一套。

## 规划的能力（v0.1）

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
- **不提供写操作**：审批需要 agent 与进行中的 turn，HTTP 路由没有这个上下文；写操作请让模型调用工具（会走审批）。详见 [docs/08 ADR-020](docs/08-决策记录.md)。

## 设计红线

1. **不用 shell**：`execFile('git', argv)`，永不拼接字符串。
2. **凭据只有引用**：配置里只有 `GITHUB_TOKEN` 这样的名字，值由 `ctx.credentials` 逐操作解析，不落盘、不进日志、不进会话。
3. **危险操作没有入口**：不提供 `reset --hard` / `clean -fd` / `checkout -- .` 的工具，而不是「提供了再拦」。

## 目录

```text
dsh-git/
├─ docs/                      # 设计与执行文档
│  ├─ 00-执行总览.md
│  ├─ 01-需求与范围.md
│  ├─ 02-生态调研与能力矩阵.md
│  ├─ 03-架构设计.md
│  ├─ 04-实施计划.md
│  ├─ 05-开发与运行手册.md
│  ├─ 06-测试与验收.md
│  ├─ 07-安全与权限.md
│  └─ 08-决策记录.md
├─ packages/                  # 8 个包
│  ├─ core/        dsh-git-core         服务定义 + ctx.gitRisk ✅
│  ├─ local/       dsh-git-local        本地 git Provider（spawn argv）✅
│  ├─ github/      dsh-git-github       GitHub Provider（REST + fetch）✅
│  ├─ tool-git/    dsh-git-tool-git     本地 git 工具（11 个）✅
│  ├─ tool-github/ dsh-git-tool-github  GitHub 工具（8 个 gh_*）✅
│  ├─ policy/      dsh-git-policy       风险表 + tools/pre-execute 策略 ✅
│  ├─ client/      dsh-git-client       Web 侧边栏面板 ⏳ M4
│  └─ bundle/      dsh-git              bundle：cordis.patch.yml ✅
├─ examples/cordis.dev.yml    # 本地 --patch 调试 overlay
├─ scripts/smoke.mjs          # 不起 GUI 的加载冒烟
└─ .github/workflows/ci.yml   # typecheck / build / test / smoke
```

## 本地验证

```powershell
pnpm install
pnpm typecheck      # 8 个包的类型检查
pnpm build          # tsdown → 每包 lib/index.js + lib/index.d.ts
pnpm test           # 94 个测试（真实临时仓库集成 + 假 fetch 的 GitHub 客户端 + 客户端 bundle 沙箱）
pnpm smoke          # 挂到真实 cordis Context，断言 ctx.git / ctx.github / 19 个工具
pnpm verify         # 以上四步串起来
```

把本地代码插进任意 profile（不需要打包）：

```powershell
dsh --profile web --patch D:\work\open0x01\dsh-git\examples\cordis.dev.yml --dump-config
```

`--dump-config` 里能看到 `dsh-git-core` / `dsh-git-local` / `dsh-git-policy` / `dsh-git-tool-git` 四行，
且 `name` 已被解析成 `file:///…/packages/<pkg>/lib/index.js`，即 M0 的验收信号。

## 安装（发布后）

```powershell
dsh plugin --profile <name> add dsh-git
dsh --profile <name> --dump-config | Select-String dsh-git
```

## 文档导航

| 想知道 | 看 |
|---|---|
| 这个项目到底做什么、现在到哪一步 | [00 执行总览](docs/00-执行总览.md) |
| 为什么这样设计、不做哪些 | [01 需求与范围](docs/01-需求与范围.md) |
| 别人已经做了什么、我们抄什么 | [02 生态调研与能力矩阵](docs/02-生态调研与能力矩阵.md) |
| 包怎么分、服务契约长什么样 | [03 架构设计](docs/03-架构设计.md) |
| 排期、任务、风险 | [04 实施计划](docs/04-实施计划.md) |
| 怎么跑起来 | [05 开发与运行手册](docs/05-开发与运行手册.md) |
| 怎么测、发布前查什么 | [06 测试与验收](docs/06-测试与验收.md) |
| 安全边界 | [07 安全与权限](docs/07-安全与权限.md) |
| 为什么不用某个方案 | [08 决策记录](docs/08-决策记录.md) |
| 怎么发版、怎么回滚 | [09 发布清单](docs/09-发布清单.md) |

## 环境基线

| 组件 | 本机验证版本 | 说明 |
|---|---|---|
| dsh | 0.2.1-rc.2 | 插件 API 以该版本为准 |
| Node.js | v24.15.0 | `engines: >=22` |
| pnpm | 11.22.0 | `packageManager` 固定 |
| git | 2.54.0.windows.1 | ≥ 2.26（worktree） |

## 与生态的关系

`dsh-git` 不修改任何现有插件，也不要求卸载它们；同装时的冲突与处理方式写在 [02 §4](docs/02-生态调研与能力矩阵.md)。

## 许可证

[MIT](LICENSE)。文档中引用的第三方插件信息仅用于技术调研。
