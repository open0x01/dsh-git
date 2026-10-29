/**
 * `git status --porcelain=v2` 的解析器。
 *
 * 选 v2 而不是 `--porcelain=v1`：v2 用字段而不是列位置表达状态，
 * 重命名、未合并、子模块都有独立记录类型，不需要猜列。
 *
 * @module dsh-git-local/status
 */

import type { FileChange, StatusResult } from 'dsh-git-core'

/** porcelain v2 的单个文件状态字母 → 领域状态。 */
function mapCode(code: string): FileChange['status'] | null {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'modified'
    case 'U':
      return 'unmerged'
    default:
      return null
  }
}

const ORDINARY = /^1 ([^ ]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s
const RENAMED = /^2 ([^ ]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s
const UNMERGED = /^u ([^ ]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s

/**
 * 解析 `--porcelain=v2 --branch -z` 的输出。
 *
 * @param stdout - 子进程输出（NUL 分隔）
 * @returns 分组后的状态
 */
export function parseStatusV2(stdout: string): StatusResult {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: FileChange[] = []
  let ahead = 0
  let behind = 0
  let upstream: string | null = null

  const records = stdout.split('\0')

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === '') continue

    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.upstream') upstream = value
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value)
        if (match) {
          ahead = Number(match[1])
          behind = Number(match[2])
        }
      }
      continue
    }

    if (record.startsWith('? ')) {
      untracked.push({ path: record.slice(2), status: 'untracked', staged: false, binary: false })
      continue
    }

    if (record.startsWith('! ')) continue

    const ordinary = ORDINARY.exec(record)
    if (ordinary) {
      const xy = ordinary[1] ?? '..'
      const path = ordinary[8] ?? ''
      const indexCode = mapCode(xy[0] ?? '.')
      const workCode = mapCode(xy[1] ?? '.')
      if (indexCode) staged.push({ path, status: indexCode, staged: true, binary: false })
      if (workCode) unstaged.push({ path, status: workCode, staged: false, binary: false })
      continue
    }

    const renamed = RENAMED.exec(record)
    if (renamed) {
      const xy = renamed[1] ?? '..'
      const path = renamed[9] ?? ''
      const oldPath = records[index + 1] ?? ''
      index += 1
      const indexCode = mapCode(xy[0] ?? '.')
      const workCode = mapCode(xy[1] ?? '.')
      if (indexCode) {
        staged.push({ path, oldPath, status: indexCode, staged: true, binary: false })
      }
      if (workCode) {
        unstaged.push({ path, oldPath, status: workCode, staged: false, binary: false })
      }
      continue
    }

    const unmerged = UNMERGED.exec(record)
    if (unmerged) {
      const path = unmerged[10] ?? ''
      staged.push({ path, status: 'unmerged', staged: true, binary: false })
      unstaged.push({ path, status: 'unmerged', staged: false, binary: false })
    }
  }

  return { staged, unstaged, untracked, ahead, behind, upstream, operation: null }
}
