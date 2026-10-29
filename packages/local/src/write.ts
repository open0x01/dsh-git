/**
 * 写操作：stage / unstage / commit / branch / stash / worktree。
 *
 * 所有动作都只由**固定 argv** 表达；用户输入只作为单个 argv 元素或 stdin 出现。
 * 破坏性操作（`reset --hard`、`clean -fd`、`checkout -- .`）在这里没有对应函数，
 * 也没有 `raw(args)` 逃生口（docs/08 ADR-006）。
 *
 * @module dsh-git-local/write
 */

import { dirname, join, resolve } from 'node:path'
import {
  GitError,
  type BranchAction,
  type BranchInfo,
  type CommitInput,
  type CommitResult,
  type RepoRef,
  type StashAction,
  type StashEntry,
  type WorktreeAction,
  type WorktreeInfo,
} from 'dsh-git-core'
import { isInside, normalizePaths } from './paths.js'
import { runGit, runGitOk, type RunOptions } from './runner.js'

/** 写操作需要的执行上下文。 */
export interface WriteContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
  worktreeRoot: string
  allowNoVerify: boolean
}

function base(context: WriteContext, repo: RepoRef): RunOptions {
  return { ...context.run, cwd: repo.root }
}

/**
 * 校验分支名。
 *
 * 先拒绝前导 `-`（避免被当成 git 选项），再交给 `git check-ref-format` 判定。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param name - 候选分支名
 */
async function assertBranchName(context: WriteContext, repo: RepoRef, name: string): Promise<void> {
  if (name.trim() === '' || name.startsWith('-')) {
    throw new GitError('invalid-ref', `非法的分支名：${name}`, {
      hint: '分支名不能为空，也不能以 - 开头',
    })
  }
  const result = await runGit(context.gitPath, ['check-ref-format', '--branch', name], base(context, repo))
  if (result.exitCode !== 0) {
    throw new GitError('invalid-ref', `非法的分支名：${name}`, {
      hint: '分支名不能包含空格、..、~、^、:、?、*、[ 等字符',
    })
  }
}

/**
 * 暂存路径（含删除与重命名）。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param paths - 路径
 */
export async function stagePaths(
  context: WriteContext,
  repo: RepoRef,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    throw new GitError('command-failed', '没有指定要暂存的路径', { hint: '至少给一个路径' })
  }
  const relative = normalizePaths(repo.root, paths)
  await runGitOk(
    context.gitPath,
    ['add', '-A', '--', ...relative],
    base(context, repo),
    '确认这些路径在仓库内且存在',
  )
}

/**
 * 取消暂存。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param paths - 路径
 */
export async function unstagePaths(
  context: WriteContext,
  repo: RepoRef,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    throw new GitError('command-failed', '没有指定要取消暂存的路径', { hint: '至少给一个路径' })
  }
  const relative = normalizePaths(repo.root, paths)
  const args = repo.head === null
    ? ['rm', '--cached', '--quiet', '--', ...relative]
    : ['reset', '--quiet', 'HEAD', '--', ...relative]
  await runGitOk(context.gitPath, args, base(context, repo), '这些路径可能本来就不在索引里')
}

/**
 * 提交。
 *
 * 提交说明通过 stdin（`-F -`）传入，因此多行、引号、`$()` 都原样保留。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param input - message / paths / amend
 * @returns 提交结果
 */
export async function commitChanges(
  context: WriteContext,
  repo: RepoRef,
  input: CommitInput,
): Promise<CommitResult> {
  if (input.message.trim() === '') {
    throw new GitError('command-failed', '提交说明不能为空', { hint: '给出至少一行说明' })
  }
  if (input.paths !== undefined && input.paths.length > 0) {
    await stagePaths(context, repo, input.paths)
  }
  if (input.noVerify === true && !context.allowNoVerify) {
    throw new GitError('unsupported', '当前配置不允许 commit --no-verify', {
      hint: '需要时在 dsh-git-local 配置里把 allowNoVerify 设为 true',
    })
  }

  const args = ['commit', '-F', '-']
  if (input.amend === true) args.push('--amend')
  if (input.noVerify === true) args.push('--no-verify')

  const result = await runGit(context.gitPath, args, { ...base(context, repo), input: input.message })
  if (result.exitCode !== 0) {
    const message = result.stderr.trim()
    throw new GitError('command-failed', 'git commit 失败', {
      ...(message === '' ? {} : { stderr: message }),
      hint: '常见原因：没有已暂存的变更、缺少 user.name/user.email、hooks 拒绝提交',
    })
  }

  const sha = await runGitOk(context.gitPath, ['rev-parse', 'HEAD'], base(context, repo))
  const summary = await runGitOk(context.gitPath, ['show', '-s', '--format=%s', 'HEAD'], base(context, repo))
  const changed = await runGitOk(
    context.gitPath,
    ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD'],
    base(context, repo),
  )
  const filesChanged = changed.stdout.split('\n').filter((line) => line.trim() !== '').length

  return {
    sha: sha.stdout.trim(),
    shortSha: sha.stdout.trim().slice(0, 7),
    summary: summary.stdout.trim(),
    filesChanged,
  }
}

/** 解析 `%(upstream:track)`。 */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead === null ? 0 : Number(ahead[1]), behind: behind === null ? 0 : Number(behind[1]) }
}

/**
 * 分支操作。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param action - 动作
 * @returns 操作后的分支列表
 */
export async function branchAction(
  context: WriteContext,
  repo: RepoRef,
  action: BranchAction,
): Promise<BranchInfo[]> {
  if (action.action === 'create') {
    await assertBranchName(context, repo, action.name)
    const args = ['branch', action.name]
    if (action.from !== undefined) args.push(action.from)
    await runGitOk(context.gitPath, args, base(context, repo), '分支可能已存在，或起点引用不存在')
  } else if (action.action === 'switch') {
    await assertBranchName(context, repo, action.name)
    await runGitOk(
      context.gitPath,
      ['switch', action.name],
      base(context, repo),
      '切换前先处理未提交的变更；分支不存在时先 create',
    )
  } else if (action.action === 'delete') {
    await assertBranchName(context, repo, action.name)
    const args = ['branch', action.force === true ? '-D' : '-d', action.name]
    await runGitOk(
      context.gitPath,
      args,
      base(context, repo),
      '未合并的分支需要 force: true；当前分支不能删除',
    )
  }

  const result = await runGitOk(
    context.gitPath,
    [
      'for-each-ref',
      '--format=%(refname:short)\u001f%(objectname)\u001f%(upstream:short)\u001f%(upstream:track)',
      'refs/heads',
    ],
    base(context, repo),
  )

  // 分支可能在本次操作中改变（switch / create），所以当前分支以 git 为准而不是入参 repo.branch
  const currentResult = await runGit(
    context.gitPath,
    ['symbolic-ref', '--short', '--quiet', 'HEAD'],
    base(context, repo),
  )
  const current = currentResult.exitCode === 0 ? currentResult.stdout.trim() : repo.branch

  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name = '', sha = '', upstream = '', track = ''] = line.split('\u001f')
      const { ahead, behind } = parseTrack(track)
      return {
        name,
        current: name === current,
        sha,
        upstream: upstream === '' ? null : upstream,
        ahead,
        behind,
      }
    })
}

/**
 * stash 操作。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param action - 动作
 * @returns stash 列表
 */
export async function stashAction(
  context: WriteContext,
  repo: RepoRef,
  action: StashAction,
): Promise<StashEntry[]> {
  if (action.action === 'save') {
    const args = ['stash', 'push']
    if (action.message !== undefined && action.message.trim() !== '') args.push('-m', action.message)
    if (action.includeUntracked === true) args.push('--include-untracked')
    const result = await runGit(context.gitPath, args, base(context, repo))
    if (result.exitCode !== 0) {
      const message = result.stderr.trim()
      throw new GitError('command-failed', 'git stash push 失败', {
        ...(message === '' ? {} : { stderr: message }),
        hint: '工作区没有可 stash 的变更时会失败',
      })
    }
  } else if (action.action === 'pop' || action.action === 'drop') {
    const index = Math.max(0, Math.trunc(action.index ?? 0))
    const reference = `stash@{${index}}`
    const args = action.action === 'pop' ? ['stash', 'pop', reference] : ['stash', 'drop', reference]
    const result = await runGit(context.gitPath, args, base(context, repo))
    if (result.exitCode !== 0) {
      const message = result.stderr.trim()
      throw new GitError('command-failed', `git stash ${action.action} 失败`, {
        ...(message === '' ? {} : { stderr: message }),
        hint: '索引可能越界，或 pop 时出现冲突（先用 git_status 检查）',
      })
    }
  }

  const result = await runGitOk(
    context.gitPath,
    ['stash', 'list', '--format=%gd\u001f%H\u001f%s'],
    base(context, repo),
  )

  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, position) => {
      const [reference = '', sha = '', subject = ''] = line.split('\u001f')
      const match = /stash@\{(\d+)\}/.exec(reference)
      const branch = /^WIP on ([^:]+):/.exec(subject)
      return {
        index: match === null ? position : Number(match[1]),
        sha,
        message: subject,
        branch: branch === null ? '' : branch[1] ?? '',
      }
    })
}

/**
 * 解析 `git worktree list --porcelain`。
 *
 * @param stdout - 原始输出
 * @returns 工作树列表
 */
export function parseWorktreeList(stdout: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = []
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== '')
    if (lines.length === 0) continue
    let path = ''
    let head = ''
    let branch: string | null = null
    let bare = false
    let detached = false
    let locked = false
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice(9)
      else if (line.startsWith('HEAD ')) head = line.slice(5)
      else if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'bare') bare = true
      else if (line === 'detached') detached = true
      else if (line === 'locked' || line.startsWith('locked ')) locked = true
    }
    if (path === '') continue
    result.push({ path, head, branch, bare, detached, locked, main: result.length === 0 })
  }
  return result
}

/**
 * worktree 操作。create 只能落在 `worktreeRoot` 下，remove 一律保守拒绝。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param action - 动作
 * @returns 工作树列表
 */
export async function worktreeAction(
  context: WriteContext,
  repo: RepoRef,
  action: WorktreeAction,
): Promise<WorktreeInfo[]> {
  const listing = async (): Promise<WorktreeInfo[]> => {
    const result = await runGitOk(
      context.gitPath,
      ['worktree', 'list', '--porcelain'],
      base(context, repo),
    )
    return parseWorktreeList(result.stdout)
  }

  if (action.action === 'create') {
    const root = resolve(dirname(repo.root), context.worktreeRoot)
    const target = action.path === undefined
      ? join(root, action.branch ?? `wt-${Date.now()}`)
      : resolve(root, action.path)
    if (!isInside(root, target)) {
      throw new GitError('path-outside-repo', `worktree 必须创建在 ${root} 之下`, {
        hint: '改 path，或调整 dsh-git-local.worktreeRoot',
      })
    }
    const args = ['worktree', 'add']
    if (action.branch !== undefined && action.createBranch !== false) {
      await assertBranchName(context, repo, action.branch)
      args.push('-b', action.branch)
    } else if (action.branch !== undefined) {
      await assertBranchName(context, repo, action.branch)
    }
    args.push(target)
    if (action.branch !== undefined && action.createBranch === false) args.push(action.branch)
    await runGitOk(context.gitPath, args, base(context, repo), '目标目录可能已存在，或分支已被占用')
  } else if (action.action === 'remove') {
    const worktrees = await listing()
    const target = resolve(action.path)
    const found = worktrees.find((entry) => resolve(entry.path) === target)
    if (found === undefined) {
      throw new GitError('invalid-ref', `不是已知的 worktree：${action.path}`, {
        hint: '先用 git_worktree{action:"list"} 查看路径',
      })
    }
    if (found.main) {
      throw new GitError('unsupported', '拒绝删除主工作树', { hint: '主工作树不能通过 worktree remove 删除' })
    }
    if (resolve(found.path) === resolve(repo.root)) {
      throw new GitError('unsupported', '拒绝删除当前工作树', { hint: '先切换到另一个工作树再删除' })
    }
    if (found.locked) {
      throw new GitError('unsupported', '拒绝删除已锁定的工作树', { hint: '先 git worktree unlock' })
    }
    const dirty = await runGit(context.gitPath, ['status', '--porcelain'], {
      ...context.run,
      cwd: found.path,
    })
    if (dirty.exitCode === 0 && dirty.stdout.trim() !== '') {
      throw new GitError('unsupported', '拒绝删除有未提交变更的工作树', {
        hint: '先在工作树内提交或清理变更',
      })
    }
    await runGitOk(
      context.gitPath,
      ['worktree', 'remove', found.path],
      base(context, repo),
      '工作树可能有子模块或残留文件，需要手工处理',
    )
  }

  return listing()
}
