/**
 * `git log`：结构化提交列表，支持 `--graph` 前缀。
 *
 * @module dsh-git-local/log
 */

import { GitError, type CommitInfo, type LogOptions, type RepoRef } from 'dsh-git-core'
import { normalizePaths } from './paths.js'
import { runGit, type RunOptions } from './runner.js'

/** log 需要的执行上下文。 */
export interface LogContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
}

/** 记录起始标记：保证能和 graph 的连接线区分开。 */
const RECORD_MARK = '\u0001'

/** 字段分隔符。 */
const FIELD_MARK = '\u001f'

/** 字段顺序：sha、短 sha、作者、邮箱、ISO 日期、父提交、主题。 */
const PRETTY = `--pretty=format:${RECORD_MARK}%H${FIELD_MARK}%h${FIELD_MARK}%an${FIELD_MARK}%ae${FIELD_MARK}%aI${FIELD_MARK}%P${FIELD_MARK}%s`

/** 默认与上限条数。 */
export const LOG_DEFAULT_LIMIT = 20
export const LOG_MAX_LIMIT = 200

/**
 * 解析一行提交记录。
 *
 * @param line - 可能带 graph 前缀的一行
 * @returns 提交信息；不是记录行时返回 null
 */
export function parseLogLine(line: string): CommitInfo | null {
  const mark = line.indexOf(RECORD_MARK)
  if (mark === -1) return null
  const graph = line.slice(0, mark)
  const fields = line.slice(mark + 1).split(FIELD_MARK)
  const [sha, shortSha, author, authorEmail, date, parents, subject] = fields
  if (sha === undefined || shortSha === undefined) return null
  return {
    sha,
    shortSha,
    author: author ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    subject: subject ?? '',
    parents: (parents ?? '').split(' ').filter((value) => value !== ''),
    ...(graph === '' ? {} : { graph }),
  }
}

/**
 * 读取提交历史。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param options - 条数、路径、是否画图、起始时间
 * @returns 提交列表（新到旧）
 */
export async function logRepo(
  context: LogContext,
  repo: RepoRef,
  options: LogOptions = {},
): Promise<CommitInfo[]> {
  const requested = options.limit ?? LOG_DEFAULT_LIMIT
  const limit = Math.min(Math.max(Math.trunc(requested), 1), LOG_MAX_LIMIT)
  const paths = options.paths === undefined ? [] : normalizePaths(repo.root, options.paths)

  const args = ['log', PRETTY, '-n', String(limit), '--no-color']
  if (options.graph === true) args.push('--graph')
  if (options.since !== undefined) args.push(`--since=${options.since}`)
  if (paths.length > 0) args.push('--', ...paths)

  const result = await runGit(context.gitPath, args, { ...context.run, cwd: repo.root })
  if (result.exitCode !== 0) {
    const message = result.stderr.trim()
    // 空仓库：`git log` 以 128 退出，这不是错误，只是没有历史
    if (/does not have any commits yet|unknown revision|bad default revision/i.test(message)) {
      return []
    }
    throw new GitError('command-failed', 'git log 失败', {
      ...(message === '' ? {} : { stderr: message }),
    })
  }

  const commits: CommitInfo[] = []
  for (const line of result.stdout.split('\n')) {
    const parsed = parseLogLine(line)
    if (parsed !== null) commits.push(parsed)
  }
  return commits
}
