/**
 * diff：四种目标、文件统计、补丁文本与截断标记。
 *
 * 一次 diff 跑两条命令：`--name-status -z` 拿文件清单与状态，
 * `--numstat -z` 拿行数统计。分开跑是因为合并输出难以可靠解析，
 * 而这两条命令的输出格式都有稳定的机器契约。
 *
 * @module dsh-git-local/diff
 */

import type { DiffOptions, DiffResult, DiffTarget, FileChange, RepoRef } from 'dsh-git-core'
import { GitError } from 'dsh-git-core'
import { normalizePaths } from './paths.js'
import { runGit, type RunOptions } from './runner.js'

/** diff 需要的执行上下文。 */
export interface DiffContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
}

/** 单个文件的统计。 */
interface NumStat {
  additions?: number
  deletions?: number
  binary: boolean
}

function statusOf(letter: string): FileChange['status'] {
  switch (letter) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    case 'T':
      return 'modified'
    default:
      return 'modified'
  }
}

/**
 * 解析 `--name-status -z` 输出。
 *
 * @param stdout - NUL 分隔的输出
 * @returns 文件清单
 */
export function parseNameStatus(stdout: string): FileChange[] {
  const parts = stdout.split('\0')
  const files: FileChange[] = []
  let index = 0
  while (index < parts.length) {
    const code = parts[index]
    index += 1
    if (code === undefined || code === '') continue
    const letter = code[0] ?? 'M'
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[index] ?? ''
      const path = parts[index + 1] ?? ''
      index += 2
      files.push({
        path,
        oldPath,
        status: statusOf(letter),
        staged: false,
        binary: false,
      })
      continue
    }
    const path = parts[index] ?? ''
    index += 1
    files.push({ path, status: statusOf(letter), staged: false, binary: false })
  }
  return files
}

/**
 * 解析 `--numstat -z` 输出。
 *
 * @param stdout - NUL 分隔的输出
 * @returns 路径 → 统计
 */
export function parseNumStat(stdout: string): Map<string, NumStat> {
  const parts = stdout.split('\0')
  const result = new Map<string, NumStat>()
  let index = 0
  while (index < parts.length) {
    const record = parts[index]
    index += 1
    if (record === undefined || record === '') continue
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(record)
    if (!match) continue
    const [, added, removed, inlinePath] = match
    let path = inlinePath ?? ''
    if (path === '') {
      // 重命名：路径被拆成 old\0new 两段
      path = parts[index + 1] ?? ''
      index += 2
    }
    const binary = added === '-' || removed === '-'
    result.set(path, {
      binary,
      ...(binary ? {} : { additions: Number(added), deletions: Number(removed) }),
    })
  }
  return result
}

/**
 * 构造某个目标的命令骨架。
 *
 * @param target - diff 目标
 * @returns git 子命令前缀
 */
function baseArgs(target: DiffTarget): string[] {
  switch (target.kind) {
    case 'unstaged':
      return ['diff']
    case 'staged':
      return ['diff', '--cached']
    case 'commit':
      return ['show', '--format=']
    case 'range':
      return ['diff', target.from, target.to]
    default: {
      const exhaustive: never = target
      throw new GitError('unsupported', `未知的 diff 目标：${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 计算一次 diff。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param target - diff 目标
 * @param options - 路径过滤、上下文行数、只看统计
 * @returns 文件清单 + 补丁
 */
export async function diffRepo(
  context: DiffContext,
  repo: RepoRef,
  target: DiffTarget,
  options: DiffOptions = {},
): Promise<DiffResult> {
  const base = { ...context.run, cwd: repo.root }
  const paths = options.paths === undefined ? [] : normalizePaths(repo.root, options.paths)
  const pathArgs = paths.length === 0 ? [] : ['--', ...paths]

  const common = ['--no-color', '--no-ext-diff']
  const commitSha = target.kind === 'commit' ? target.sha : undefined

  const nameStatusArgs = commitSha === undefined
    ? [...baseArgs(target), ...common, '--name-status', '-z', ...pathArgs]
    : ['show', '--format=', ...common, '--name-status', '-z', commitSha, ...pathArgs]

  const numStatArgs = commitSha === undefined
    ? [...baseArgs(target), ...common, '--numstat', '-z', ...pathArgs]
    : ['show', '--format=', ...common, '--numstat', '-z', commitSha, ...pathArgs]

  const nameStatus = await runGit(context.gitPath, nameStatusArgs, base)
  if (nameStatus.exitCode !== 0) {
    throw new GitError('command-failed', 'git diff 失败', {
      ...(nameStatus.stderr.trim() === '' ? {} : { stderr: nameStatus.stderr.trim() }),
      hint: '确认提交 sha / 分支名存在，且仓库没有损坏',
    })
  }

  const numStat = await runGit(context.gitPath, numStatArgs, base)
  const stats = numStat.exitCode === 0 ? parseNumStat(numStat.stdout) : new Map<string, NumStat>()

  const files = parseNameStatus(nameStatus.stdout).map((file) => {
    const stat = stats.get(file.path)
    if (stat === undefined) return file
    return {
      ...file,
      ...(stat.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat.deletions === undefined ? {} : { deletions: stat.deletions }),
      binary: stat.binary,
    }
  })

  if (options.statOnly === true) {
    return { files, patch: '', truncated: false }
  }

  const contextLines = options.contextLines
  const patchArgs = commitSha === undefined
    ? [
        ...baseArgs(target),
        ...common,
        '--patch',
        ...(contextLines === undefined ? [] : [`-U${contextLines}`]),
        ...pathArgs,
      ]
    : [
        'show',
        '--format=',
        ...common,
        '--patch',
        ...(contextLines === undefined ? [] : [`-U${contextLines}`]),
        commitSha,
        ...pathArgs,
      ]

  const patch = await runGit(context.gitPath, patchArgs, base)
  if (patch.exitCode !== 0) {
    throw new GitError('command-failed', 'git diff --patch 失败', {
      ...(patch.stderr.trim() === '' ? {} : { stderr: patch.stderr.trim() }),
    })
  }

  return { files, patch: patch.stdout, truncated: patch.truncated }
}
