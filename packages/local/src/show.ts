/**
 * `git show`：单个提交的元数据 + 补丁。
 *
 * @module dsh-git-local/show
 */

import { GitError, type RepoRef, type ShowResult } from 'dsh-git-core'
import { diffRepo, type DiffContext } from './diff.js'
import { parseLogLine } from './log.js'
import { runGit } from './runner.js'

/** show 复用 diff 的执行上下文。 */
export type ShowContext = DiffContext

/** 与 log 保持一致的字段格式。 */
const PRETTY = `--format=\u0001%H\u001f%h\u001f%an\u001f%ae\u001f%aI\u001f%P\u001f%s`

/**
 * 读取一个提交。
 *
 * @param context - 执行上下文
 * @param repo - 已解析的仓库
 * @param sha - 提交 sha 或引用
 * @returns 提交信息与补丁
 * @throws GitError `invalid-ref` / `command-failed`
 */
export async function showRepo(
  context: ShowContext,
  repo: RepoRef,
  sha: string,
): Promise<ShowResult> {
  if (sha.trim() === '' || sha.startsWith('-')) {
    throw new GitError('invalid-ref', `非法的提交引用：${sha}`, { hint: '传入 sha 或分支名' })
  }

  const result = await runGit(context.gitPath, ['show', '-s', '--no-color', PRETTY, sha], {
    ...context.run,
    cwd: repo.root,
  })

  if (result.exitCode !== 0) {
    throw new GitError('invalid-ref', `找不到提交：${sha}`, {
      ...(result.stderr.trim() === '' ? {} : { stderr: result.stderr.trim() }),
      hint: '先用 git_log 确认提交是否存在',
    })
  }

  const commit = parseLogLine(result.stdout.split('\n')[0] ?? '')
  if (commit === null) {
    throw new GitError('command-failed', 'git show 输出无法解析', { hint: '请把该输出反馈给插件作者' })
  }

  const diff = await diffRepo(context, repo, { kind: 'commit', sha: commit.sha }, {})
  return { commit, diff }
}
