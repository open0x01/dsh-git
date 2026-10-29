/**
 * `git remote -v` 的解析与读取。
 *
 * @module dsh-git-local/remotes
 */

import type { RemoteInfo, RepoRef } from 'dsh-git-core'
import { runGit, type RunOptions } from './runner.js'

/** remotes 需要的执行上下文。 */
export interface RemotesContext {
  gitPath: string
  run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env' | 'signal'>
}

/**
 * 解析 `git remote -v` 输出。
 *
 * 每行形如 `<name>\t<url> (fetch)` 或 `<name>\t<url> (push)`。
 *
 * @param stdout - 原始输出
 * @returns 远端列表（按名称首次出现顺序）
 */
export function parseRemotes(stdout: string): RemoteInfo[] {
  const order: string[] = []
  const fetchUrls = new Map<string, string>()
  const pushUrls = new Map<string, string>()

  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\t(.+?) \((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const [, name = '', url = '', kind = 'fetch'] = match
    if (!order.includes(name)) order.push(name)
    if (kind === 'fetch') fetchUrls.set(name, url)
    else pushUrls.set(name, url)
  }

  return order.map((name) => {
    const url = fetchUrls.get(name) ?? pushUrls.get(name) ?? ''
    const pushUrl = pushUrls.get(name)
    return {
      name,
      url,
      pushUrl: pushUrl === undefined || pushUrl === url ? null : pushUrl,
    }
  })
}

/**
 * 读取仓库的远端列表。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @returns 远端列表
 */
export async function remotesRepo(context: RemotesContext, repo: RepoRef): Promise<RemoteInfo[]> {
  const result = await runGit(context.gitPath, ['remote', '-v'], {
    ...context.run,
    cwd: repo.root,
  })
  if (result.exitCode !== 0) return []
  return parseRemotes(result.stdout)
}
