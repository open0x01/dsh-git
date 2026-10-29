/**
 * `ctx.git` 服务定义：本地 Git 的唯一入口。
 *
 * 这里只有抽象类与类型，没有任何实现；`dsh-git-local` 提供实现，
 * `dsh-git-tool-git` / `dsh-git-client` 消费它。
 *
 * @module dsh-git-core/git
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  Abortable,
  BranchAction,
  BranchInfo,
  BlameLine,
  CommitInfo,
  DiffOptions,
  DiffResult,
  DiffTarget,
  LogOptions,
  RepoRef,
  ShowResult,
  StashAction,
  StashEntry,
  StatusOptions,
  StatusResult,
  WorktreeAction,
  WorktreeInfo,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitService
  }
}

/** 提交输入。 */
export interface CommitInput extends Abortable {
  /** 提交说明；多行原样保留（走 stdin，不经过 shell） */
  message: string
  /** 只提交这些路径；省略则提交全部已暂存内容 */
  paths?: string[]
  /** 是否 amend 上一个提交 */
  amend?: boolean
  /** 是否跳过 hooks；需要 Provider 配置显式允许（默认拒绝） */
  noVerify?: boolean
}

/** 提交结果。 */
export interface CommitResult {
  sha: string
  shortSha: string
  /** 提交说明首行 */
  summary: string
  /** 本次提交包含的文件数 */
  filesChanged: number
}

/**
 * 本地 Git 服务。
 *
 * 契约约束（任何 Provider 都必须满足）：
 * - `resolveRepo` 返回的 `root` 必须 realpath 过；所有路径参数相对它解析，越界即 `path-outside-repo`。
 * - 所有方法接受 `signal`，并在 abort 时终止子进程。
 * - 不提供 `raw(args)` 逃生方法：新增能力走新增方法。
 */
export abstract class GitService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /** 解析仓库：`cwd` 向上找工作区根；受 allowedRoots 约束。 */
  abstract resolveRepo(cwd: string, options?: Abortable): Promise<RepoRef>

  /** 工作区状态：分组变更 + ahead/behind。 */
  abstract status(repo: RepoRef, options?: StatusOptions): Promise<StatusResult>

  /** 四种目标的 diff。 */
  abstract diff(repo: RepoRef, target: DiffTarget, options?: DiffOptions): Promise<DiffResult>

  /** 提交历史。 */
  abstract log(repo: RepoRef, options?: LogOptions): Promise<CommitInfo[]>

  /** 单个提交的元数据与补丁。 */
  abstract show(repo: RepoRef, sha: string, options?: Abortable): Promise<ShowResult>

  /** 逐行归属。 */
  abstract blame(
    repo: RepoRef,
    path: string,
    range?: { start: number; end: number },
    options?: Abortable,
  ): Promise<BlameLine[]>

  /** 暂存路径（含删除与重命名）。 */
  abstract stage(repo: RepoRef, paths: string[], options?: Abortable): Promise<void>

  /** 取消暂存路径。 */
  abstract unstage(repo: RepoRef, paths: string[], options?: Abortable): Promise<void>

  /** 提交。 */
  abstract commit(repo: RepoRef, input: CommitInput): Promise<CommitResult>

  /** 分支操作。 */
  abstract branch(repo: RepoRef, action: BranchAction, options?: Abortable): Promise<BranchInfo[]>

  /** stash 操作。 */
  abstract stash(repo: RepoRef, action: StashAction, options?: Abortable): Promise<StashEntry[]>

  /** worktree 操作。 */
  abstract worktree(
    repo: RepoRef,
    action: WorktreeAction,
    options?: Abortable,
  ): Promise<WorktreeInfo[]>
}
