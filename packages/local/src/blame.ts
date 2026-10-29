/**
 * `git blame --line-porcelain`：逐行归属。
 *
 * @module dsh-git-local/blame
 */

import { GitError, type BlameLine, type RepoRef } from 'dsh-git-core'
import { normalizePaths } from './paths.js'
import { runGit, type RunOptions } from './runner.js'

/** blame 需要的执行上下文。 */
export interface BlameContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
}

const HEADER = /^([0-9a-f]{7,64}) (\d+) (\d+)(?: (\d+))?$/

/**
 * 把 epoch 秒转成 ISO 8601（UTC）。
 *
 * @param seconds - Unix 时间戳（秒）
 * @returns ISO 字符串
 */
function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

/**
 * 解析 `--line-porcelain` 输出。
 *
 * @param stdout - 原始输出
 * @returns 逐行结果
 */
export function parseBlamePorcelain(stdout: string): BlameLine[] {
  const lines: BlameLine[] = []
  const rows = stdout.split('\n')
  let index = 0
  while (index < rows.length) {
    const header = HEADER.exec(rows[index] ?? '')
    if (!header) {
      index += 1
      continue
    }
    const sha = header[1] ?? ''
    const finalLine = Number(header[3] ?? '0')
    let author = ''
    let time = 0
    let content = ''
    index += 1
    while (index < rows.length) {
      const row = rows[index] ?? ''
      index += 1
      if (row.startsWith('\t')) {
        content = row.slice(1)
        break
      }
      if (row.startsWith('author ')) author = row.slice(7)
      else if (row.startsWith('author-time ')) time = Number(row.slice(12))
    }
    lines.push({
      line: finalLine,
      sha,
      shortSha: sha.slice(0, 7),
      author,
      date: Number.isFinite(time) ? toIso(time) : '',
      content,
    })
  }
  return lines
}

/**
 * 读取逐行归属。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param path - 文件路径（相对仓库根）
 * @param range - 可选行范围（1 起，含两端）
 * @returns 逐行结果
 */
export async function blameRepo(
  context: BlameContext,
  repo: RepoRef,
  path: string,
  range?: { start: number; end: number },
): Promise<BlameLine[]> {
  const [relative] = normalizePaths(repo.root, [path])
  if (relative === undefined) {
    throw new GitError('command-failed', '缺少文件路径', { hint: '传入仓库内的文件路径' })
  }

  const args = ['blame', '--line-porcelain']
  if (range !== undefined) {
    const start = Math.max(1, Math.trunc(range.start))
    const end = Math.max(start, Math.trunc(range.end))
    args.push('-L', `${start},${end}`)
  }
  args.push('--', relative)

  const result = await runGit(context.gitPath, args, { ...context.run, cwd: repo.root })
  if (result.exitCode !== 0) {
    const message = result.stderr.trim()
    throw new GitError('command-failed', `git blame 失败：${relative}`, {
      ...(message === '' ? {} : { stderr: message }),
      hint: '确认文件已被跟踪（未跟踪文件无法 blame）',
    })
  }
  return parseBlamePorcelain(result.stdout)
}
