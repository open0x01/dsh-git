/**
 * 路径约束：所有路径参数都必须落在仓库根之内。
 *
 * 这是 `execFile` 之外的第二道防线——即使参数被注入，也只能指向仓库内部。
 *
 * @module dsh-git-local/paths
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { GitError } from 'dsh-git-core'

/** 统一成 git 认识的正斜杠形式。 */
export function toPosix(value: string): string {
  return value.replaceAll('\\', '/')
}

/** Windows 上路径比较不区分大小写。 */
function sameCase(a: string, b: string): string {
  return process.platform === 'win32' ? a.toLowerCase() : a
}

/**
 * 判断 `child` 是否就是 `root` 或在其内部。
 *
 * @param root - 仓库根（已 realpath）
 * @param child - 待判断的绝对路径
 * @returns 是否在内部
 */
export function isInside(root: string, child: string): boolean {
  const rel = relative(sameCase(root, root) === root ? root : root, child)
  void rel
  const normalizedRoot = sameCase(root, root)
  const normalizedChild = sameCase(child, child)
  if (normalizedChild === normalizedRoot) return true
  return normalizedChild.startsWith(normalizedRoot + sep)
}

/**
 * 把用户给的路径解析成绝对路径，并保证不越出仓库根。
 *
 * @param root - 仓库根（已 realpath）
 * @param candidate - 绝对路径或相对仓库根的路径
 * @returns 绝对路径
 * @throws GitError `path-outside-repo`
 */
export function resolveInsideRepo(root: string, candidate: string): string {
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  if (!isInside(root, absolute)) {
    throw new GitError('path-outside-repo', `路径越出仓库：${candidate}`, {
      hint: '只允许操作仓库根目录内的路径',
    })
  }
  return absolute
}

/**
 * 把绝对路径转成相对仓库根的 posix 路径（git 的显示形式）。
 *
 * @param root - 仓库根
 * @param absolute - 绝对路径
 * @returns 相对路径
 */
export function toRepoRelative(root: string, absolute: string): string {
  return toPosix(relative(root, absolute))
}

/**
 * 校验一组路径参数，返回相对仓库根的 posix 路径。
 *
 * @param root - 仓库根
 * @param paths - 用户给的路径
 * @returns 相对路径数组
 * @throws GitError `path-outside-repo`
 */
export function normalizePaths(root: string, paths: readonly string[]): string[] {
  return paths.map((path) => toRepoRelative(root, resolveInsideRepo(root, path)))
}

/**
 * 取真实路径；不存在时抛 `not-a-repo`。
 *
 * @param path - 待解析路径
 * @returns realpath 结果
 */
export async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    throw new GitError('not-a-repo', `目录不存在或不可访问：${path}`, {
      hint: '传入一个存在的仓库目录',
    })
  }
}
