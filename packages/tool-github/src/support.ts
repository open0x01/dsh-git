/**
 * 工具层共用逻辑（与 `dsh-git-tool-git` 的同名文件保持同样的语义）。
 *
 * 两个工具包不互相依赖，所以这几个十几行的小函数各自持有一份；
 * 它们的契约由 `dsh-git-core` 的类型固定，不存在「两份实现会漂移」的风险。
 *
 * @module dsh-git-tool-github/support
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { isGitError, type RepoRef, type RepoSlug } from 'dsh-git-core'

/** `ctx.workingDirectory` 的类型来源；仅用于类型位置。 */
export type { WorkingDirectoryService }

/**
 * 取会话当前工作目录。
 *
 * @param ctx - 插件上下文
 * @param exec - 工具执行上下文
 * @returns 绝对目录
 */
export async function sessionDirectory(ctx: Context, exec: ToolRunContext): Promise<string> {
  const service = ctx.get('workingDirectory')
  if (service !== undefined && exec.agent !== undefined) {
    return service.ensure(exec.agent, exec.signal)
  }
  return process.cwd()
}

/**
 * 解析本次调用要操作的仓库。
 *
 * @param ctx - 插件上下文
 * @param exec - 工具执行上下文
 * @param repoDir - 模型显式给出的目录
 * @returns 已 realpath 的仓库引用
 */
export async function resolveToolRepo(
  ctx: Context,
  exec: ToolRunContext,
  repoDir?: string,
): Promise<RepoRef> {
  const cwd = repoDir ?? (await sessionDirectory(ctx, exec))
  return ctx.git.resolveRepo(cwd, { signal: exec.signal })
}

/**
 * 得到 owner/repo：显式参数优先，否则从仓库 remote 推导。
 *
 * @param ctx - 插件上下文
 * @param exec - 工具执行上下文
 * @param owner - 显式 owner
 * @param repo - 显式 repo 名
 * @param repoDir - 仓库目录
 * @returns owner/repo
 */
export async function resolveSlug(
  ctx: Context,
  exec: ToolRunContext,
  owner: string | undefined,
  repo: string | undefined,
  repoDir: string | undefined,
): Promise<RepoSlug> {
  if (owner !== undefined && repo !== undefined && owner !== '' && repo !== '') {
    return { owner, repo }
  }
  const repoRef = await resolveToolRepo(ctx, exec, repoDir)
  return ctx.github.resolveSlug(repoRef, exec.signal)
}

/**
 * 把任意错误翻成模型能直接照做的文本。
 *
 * @param error - 捕获值
 * @param toolName - 出错的工具名
 * @returns 带建议的错误
 */
export function asToolError(error: unknown, toolName: string): Error {
  if (isGitError(error)) {
    const hint = error.detail.hint === undefined ? '' : `\n建议：${error.detail.hint}`
    return new Error(`${toolName} 失败（${error.code}）：${error.message}${hint}`)
  }
  if (error instanceof Error) return new Error(`${toolName} 失败：${error.message}`)
  return new Error(`${toolName} 失败：${String(error)}`)
}

/** `owner` / `repo` / `repoDir` 三个参数的公共描述。 */
export const slugParams = {
  owner: { type: 'string', description: '仓库 owner；与 repo 同时省略时从 git remote 推导' },
  repo: { type: 'string', description: '仓库名；与 owner 同时省略时从 git remote 推导' },
  repoDir: { type: 'string', description: '用于推导 owner/repo 的本地仓库目录' },
} as const

/** 可空字符串。 */
export const nullableString = {
  oneOf: [{ type: 'string' }, { type: 'null' }],
} as const

/** 检查汇总。 */
export const checksSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    total: { type: 'integer', required: true },
    passed: { type: 'integer', required: true },
    failed: { type: 'integer', required: true },
    pending: { type: 'integer', required: true },
  },
} as const

/**
 * 检查汇总的单行文本。
 *
 * @param checks - 检查汇总
 * @returns 例如 `检查：3 通过 / 1 失败 / 0 进行中`
 */
export function describeChecks(checks: { total: number; passed: number; failed: number; pending: number }): string {
  return `检查：${checks.passed} 通过 / ${checks.failed} 失败 / ${checks.pending} 进行中（共 ${checks.total}）`
}
