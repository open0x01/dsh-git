/**
 * `LocalGitService`：`ctx.git` 的本地实现。
 *
 * 它只做三件事：把配置收敛成执行参数、调用纯函数式的解析器、把结果包成契约类型。
 *
 * @module dsh-git-local/service
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  GitService,
  type Abortable,
  type BranchAction,
  type BranchInfo,
  type BlameLine,
  type CommitInfo,
  type CommitInput,
  type CommitResult,
  type DiffOptions,
  type DiffResult,
  type DiffTarget,
  type LogOptions,
  type RepoRef,
  type ShowResult,
  type StashAction,
  type StashEntry,
  type StatusOptions,
  type StatusResult,
  type WorktreeAction,
  type WorktreeInfo,
} from 'dsh-git-core'
import type { Config } from './config.js'
import { blameRepo, type BlameContext } from './blame.js'
import { diffRepo, type DiffContext } from './diff.js'
import { logRepo, type LogContext } from './log.js'
import { resolveRepo, type ResolveContext } from './repo.js'
import { runGit, type RunOptions } from './runner.js'
import { showRepo } from './show.js'
import { parseStatusV2 } from './status.js'
import { normalizePaths } from './paths.js'
import {
  branchAction,
  commitChanges,
  stagePaths,
  stashAction,
  unstagePaths,
  worktreeAction,
  type WriteContext,
} from './write.js'

/** 解析仓库时沿用的执行参数。 */
type RunSlice = Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>

/**
 * 本地 Git 服务实现。
 */
export class LocalGitService extends GitService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
  }

  /** 把「本次调用的取消信号」折进固定配置。 */
  private slice(signal?: AbortSignal): RunSlice {
    return {
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      env: this.config.env,
      ...(signal === undefined ? {} : { signal }),
    }
  }

  override resolveRepo(cwd: string, options: Abortable = {}): Promise<RepoRef> {
    const context: ResolveContext = {
      gitPath: this.config.gitPath,
      run: this.slice(options.signal),
      allowedRoots: this.config.allowedRoots,
    }
    return resolveRepo(cwd, context)
  }

  override async status(repo: RepoRef, options: StatusOptions = {}): Promise<StatusResult> {
    const args = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']
    if (options.paths !== undefined && options.paths.length > 0) {
      args.push('--', ...normalizePaths(repo.root, options.paths))
    }
    const result = await runGit(this.config.gitPath, args, {
      ...this.slice(options.signal),
      cwd: repo.root,
    })
    if (result.exitCode !== 0) {
      throw new Error(`git status 失败：${result.stderr.trim()}`)
    }
    return { ...parseStatusV2(result.stdout), operation: repo.operation }
  }

  override diff(repo: RepoRef, target: DiffTarget, options: DiffOptions = {}): Promise<DiffResult> {
    const context: DiffContext = { gitPath: this.config.gitPath, run: this.slice(options.signal) }
    return diffRepo(context, repo, target, options)
  }

  override log(repo: RepoRef, options: LogOptions = {}): Promise<CommitInfo[]> {
    const context: LogContext = { gitPath: this.config.gitPath, run: this.slice(options.signal) }
    return logRepo(context, repo, options)
  }

  override show(repo: RepoRef, sha: string, options: Abortable = {}): Promise<ShowResult> {
    const context: DiffContext = { gitPath: this.config.gitPath, run: this.slice(options.signal) }
    return showRepo(context, repo, sha)
  }

  override blame(
    repo: RepoRef,
    path: string,
    range?: { start: number; end: number },
    options: Abortable = {},
  ): Promise<BlameLine[]> {
    const context: BlameContext = { gitPath: this.config.gitPath, run: this.slice(options.signal) }
    return blameRepo(context, repo, path, range)
  }

  override stage(repo: RepoRef, paths: string[], options: Abortable = {}): Promise<void> {
    return stagePaths(this.writeContext(options.signal), repo, paths)
  }

  override unstage(repo: RepoRef, paths: string[], options: Abortable = {}): Promise<void> {
    return unstagePaths(this.writeContext(options.signal), repo, paths)
  }

  override commit(repo: RepoRef, input: CommitInput): Promise<CommitResult> {
    return commitChanges(this.writeContext(input.signal), repo, input)
  }

  override branch(repo: RepoRef, action: BranchAction, options: Abortable = {}): Promise<BranchInfo[]> {
    return branchAction(this.writeContext(options.signal), repo, action)
  }

  override stash(repo: RepoRef, action: StashAction, options: Abortable = {}): Promise<StashEntry[]> {
    return stashAction(this.writeContext(options.signal), repo, action)
  }

  override worktree(
    repo: RepoRef,
    action: WorktreeAction,
    options: Abortable = {},
  ): Promise<WorktreeInfo[]> {
    return worktreeAction(this.writeContext(options.signal), repo, action)
  }

  private writeContext(signal?: AbortSignal): WriteContext {
    return {
      gitPath: this.config.gitPath,
      run: this.slice(signal),
      worktreeRoot: this.config.worktreeRoot,
      allowNoVerify: this.config.allowNoVerify,
    }
  }
}
