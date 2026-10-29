/**
 * 仓库解析：把任意目录变成一个可信的 {@link RepoRef}。
 *
 * 规则：
 * 1. 向上找 `--show-toplevel`，失败即 `not-a-repo`；
 * 2. `root` 必须 realpath（符号链接/8.3 短名不能导致两个"同一个仓库"；
 * 3. `allowedRoots` 非空时，root 必须落在其中一项之内。
 *
 * @module dsh-git-local/repo
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { GitError, type RepoRef } from 'dsh-git-core'
import { isInside, realPath } from './paths.js'
import { runGit, type RunOptions } from './runner.js'

/** 解析仓库所需的执行参数。 */
export interface ResolveContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
  allowedRoots: string[]
}

/** 中间态标记文件 → 操作名。 */
const OPERATION_MARKERS: ReadonlyArray<readonly [string, RepoRef['operation']]> = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 解析一个目录所属的仓库。
 *
 * @param cwd - 起始目录（工具层传会话工作目录）
 * @param context - git 路径与执行参数
 * @returns 可信的仓库引用
 * @throws GitError `not-a-repo` / `path-outside-repo` / `command-failed`
 */
export async function resolveRepo(cwd: string, context: ResolveContext): Promise<RepoRef> {
  const base = { ...context.run, cwd }

  const top = await runGit(context.gitPath, ['rev-parse', '--show-toplevel'], base)
  if (top.exitCode !== 0) {
    throw new GitError('not-a-repo', `不是 git 仓库：${cwd}`, {
      hint: '在仓库目录里操作，或用 repoDir 指向一个 git 仓库',
      ...(top.stderr.trim() === '' ? {} : { stderr: top.stderr.trim() }),
    })
  }

  const root = await realPath(top.stdout.trim())

  if (context.allowedRoots.length > 0) {
    const allowed = context.allowedRoots.some((entry) => isInside(entry, root) || isInside(root, entry))
    if (!allowed) {
      throw new GitError('path-outside-repo', `仓库不在允许的根目录内：${root}`, {
        hint: `allowedRoots = ${context.allowedRoots.join(', ')}`,
      })
    }
  }

  const gitDirResult = await runGit(context.gitPath, ['rev-parse', '--absolute-git-dir'], base)
  const gitDir = gitDirResult.exitCode === 0 ? gitDirResult.stdout.trim() : join(root, '.git')

  const headResult = await runGit(context.gitPath, ['rev-parse', '--verify', '--quiet', 'HEAD'], base)
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() : null

  const branchResult = await runGit(context.gitPath, ['symbolic-ref', '--short', '--quiet', 'HEAD'], base)
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null

  let operation: RepoRef['operation'] = null
  for (const [marker, name] of OPERATION_MARKERS) {
    if (await exists(join(gitDir, marker))) {
      operation = name
      break
    }
  }

  return { root, branch, operation, head }
}
