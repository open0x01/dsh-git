# dsh-git

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Git / GitHub 插件套件。

把「看代码改了什么、提交、开 PR、看 Issue」这些日常动作交给模型，同时保留一条硬边界：**能改仓库的操作一定经过审批，凭据永远只是一个名字**。

- **一个服务**：模型工具和界面调用同一个 `ctx.git` / `ctx.github`，语义不会两边不一致。
- **零外部二进制**：不依赖 `gh` CLI，GitHub 走纯 `fetch`；本地 git 只用 `spawn(git, argv)`，从不拼 shell 字符串。
- **默认安全**：破坏性操作（`reset --hard`、`clean -fd`、`checkout -- .`）根本没有对应工具；网络写操作默认拒绝。

## 功能

### 本地 Git（11 个工具）

| 只读 | 写（走审批） |
|---|---|
| `git_status` 工作区状态：分支、ahead/behind、已暂存/未暂存/未跟踪 | `git_stage` 加入索引 |
| `git_diff` 差异：未暂存 / 已暂存 / 某个提交 / 两个引用之间 | `git_unstage` 移出索引 |
| `git_log` 提交历史（可画提交图、可按路径过滤） | `git_commit` 提交（支持多行说明、amend） |
| `git_show` 单个提交的元数据与补丁 | `git_branch` 列出 / 创建 / 切换 / 删除分支 |
| `git_blame` 逐行归属（可限定行范围） | `git_stash` 暂存 / 列表 / 恢复 / 丢弃 |
| | `git_worktree` 工作树：列出 / 创建 / 删除（删除一律保守拒绝） |

`git_fetch` / `git_pull` / `git_push` 默认**不注册**（`enableNetwork: false`）。

### GitHub（8 个工具）

| 只读 | 联网写 |
|---|---|
| `gh_auth_status` 认证状态（不返回 token 本身） | `gh_pr_create` 创建 PR（默认 **draft**，策略默认 deny） |
| `gh_repo_view` 仓库概览、当前 token 的权限 | |
| `gh_pr_list` / `gh_pr_view` PR 列表与详情（含文件清单、CI 检查汇总） | |
| `gh_pr_diff` PR 的 unified diff | |
| `gh_issue_list` / `gh_issue_view` Issue 列表与详情 | |

`owner`/`repo` 省略时从当前仓库的 `git remote` 推导（支持 https、scp 风格 ssh、`ssh://`、GitHub Enterprise）。

### 右侧栏 Git 面板

会话级的右侧栏 tab（每个工作区各自一份），只读：

- 当前分支、与上游的 ahead/behind、进行中的合并/变基；
- 已暂存 / 未暂存 / 未跟踪三组文件，带增删行数；
- 最近提交列表，一键刷新；
- host 侧 RPC：`POST /api/dsh-git/<op>`，op 白名单 `snapshot` / `branches` / `worktrees` / `pr`。

**面板不提供写操作**：审批需要会话与进行中的回合，HTTP 路由没有这个上下文；写操作请让模型调用工具，那才是唯一经过审批的路径。

### 审批策略

| 风险等级 | 工具 | 默认处置 |
|---|---|---|
| `read` | 5 个 `git_*` 只读 + 7 个 `gh_*` 只读 | 放行 |
| `write` | `git_stage` / `git_unstage` / `git_commit` / `git_branch` / `git_stash` / `git_worktree` | 弹审批 |
| `network-write` | `gh_pr_create` | 拒绝（改配置为 `ask` 才会请求审批） |

策略只作用于本插件注册的工具，不做命令文本匹配，因此不会和别的 Git 插件叠加成双重审批。

## 安装

> 目前尚未发布到 npm。第一种方式在发布后可用；现在请用第二种「从源码安装」。

### 从 npm 安装（发布后）

```powershell
dsh plugin --profile <profile> add dsh-git
dsh --profile <profile> --dump-config | Select-String dsh-git   # 应出现 7 行 dsh-git-*
```

### 从源码安装（当前可用）

```powershell
git clone https://github.com/open0x01/dsh-git.git
cd dsh-git
pnpm install
pwsh -File scripts/install-local.ps1      # 构建 + 装进 profile gitdev
dsh --profile gitdev                      # 启动 Web UI
```

脚本做的事：构建全部包 → 生成一份可安装副本 → 在 `$DSH_HOME/profiles/gitdev` 里把 8 个包接好（`@deepseek-ai/*` 直接指向 dsh 自带的那一份，保证全进程只有一份 cordis）→ 把 `dsh-git` 加进 profile 的 bundles。

改完代码后重新 `pnpm build` 再跑一次脚本即可；客户端 `lib/client.js` 有热更新，浏览器会自动重载。

### 配置 GitHub 凭据

凭据只存**引用名**，值由 DSH 的凭据服务逐次解析，不落盘、不进日志：

```powershell
$env:GITHUB_TOKEN = "ghp_..."     # 或在 DSH 凭据里配置同名项
```

换 token 不需要重启插件，下一次操作就会生效。

### 打开面板

在任意会话里，点右侧栏的 **`+`**，选择 **Git**。

## 配置项

`dsh-git-local`（本地 git）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `gitPath` | `git` | git 可执行文件 |
| `timeoutMs` | `20000` | 单次命令超时 |
| `maxOutputBytes` | `65536` | 文本输出上限，超出截断 |
| `allowedRoots` | `[]` | 允许操作的仓库根白名单 |
| `worktreeRoot` | `.worktrees` | `git_worktree` 创建目录（相对仓库父目录） |
| `enableNetwork` | `false` | 是否允许网络类操作 |
| `allowNoVerify` | `false` | 是否允许 `commit --no-verify` |

`dsh-git-github`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `tokenRef` | `GITHUB_TOKEN` | 凭据引用名（不是值） |
| `baseUrl` | `https://api.github.com` | GitHub Enterprise 改成 `/api/v3` |
| `timeoutMs` / `retries` | `20000` / `1` | 请求超时与重试 |
| `cacheTtlMs` | `30000` | 读操作 ETag 缓存 |
| `maxFiles` / `maxDiffBytes` | `100` / `200000` | PR diff 的文件数与文本上限 |

`dsh-git-tool-git`：`toolPrefix`（默认空，用于和别的插件避让工具重名）、`enableWriteTools`（默认 `true`，关掉后只注册只读工具）。

`dsh-git-policy`：`rules.read` / `rules.write` / `rules.network-write`（默认 `allow` / `ask` / `deny`）、`allowTools`、`denyTools`。

## 开发

```powershell
pnpm install
pnpm typecheck     # 8 个包类型检查
pnpm build         # tsdown → lib/index.js + lib/index.d.ts（client 另产 lib/client.js）
pnpm test          # 99 个测试：真实临时仓库集成 + 假 fetch 的 GitHub 客户端 + 客户端 bundle 沙箱
pnpm smoke         # 挂到真实 cordis Context，断言 ctx.git / ctx.github / 19 个工具
pnpm verify        # 以上四步串起来
```

## 许可证

[MIT](LICENSE)
