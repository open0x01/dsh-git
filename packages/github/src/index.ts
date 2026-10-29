/**
 * dsh-git-github：`ctx.github` 的 REST 实现。
 *
 * **状态：v0.1 里程碑 M3 尚未实现。** 本包目前只固定配置形状与契约边界，
 * 让 bundle 层的行、配置文档与后续实现不会漂移；`apply` 不提供任何服务，
 * 因此依赖它的 `dsh-git-tool-github` 会保持 PENDING（而不是半可用）。
 *
 * 实现时必须遵守（docs/08 ADR-003 / ADR-005 / ADR-009）：
 * - 只用 `fetch`，不引入 Octokit，不包装 `gh` CLI；
 * - 配置里只有 `tokenRef`，每次操作前 `ctx.credentials.resolve()`，不缓存明文、不落盘、不进日志；
 * - 只访问 `baseUrl`（默认 api.github.com），不跟随重定向到其他 host；
 * - 401/403/429 映射为 `GitError('auth-missing' | 'rate-limited')`，带 `resetAt`。
 *
 * @module dsh-git-github
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** 配置。 */
export interface Config {
  /** 凭据引用名（不是值） */
  tokenRef: string
  /** API 基地址；GitHub Enterprise 可改 */
  baseUrl: string
  timeoutMs: number
  /** 读操作缓存 TTL */
  cacheTtlMs: number
  /** PR diff 最多返回的文件数 */
  maxFiles: number
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  tokenRef: z.string().default('GITHUB_TOKEN').description('凭据引用名；值由 ctx.credentials 解析'),
  baseUrl: z.string().default('https://api.github.com').description('API 基地址'),
  timeoutMs: z.number().default(20_000).description('单次请求超时（毫秒）'),
  cacheTtlMs: z.number().default(30_000).description('读缓存 TTL（毫秒）'),
  maxFiles: z.number().default(100).description('PR diff 最多返回的文件数'),
})

/** 插件名。 */
export const name = 'dsh-git-github'

/** 依赖凭据服务（M3 实现时生效）。 */
export const inject = ['credentials']

/**
 * 占位：M3 会在这里 `new GitHubService` 实现并挂载 `ctx.github`。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
  throw new Error(
    'dsh-git-github: GitHub Provider 尚未实现（v0.1 里程碑 M3）。请在 profile 的 cordis.patch.yml 中把该行 disabled 置为 true。',
  )
}
