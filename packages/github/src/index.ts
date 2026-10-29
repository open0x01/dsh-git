/**
 * dsh-git-github：把 `ctx.github` 挂到 GitHub REST API 上。
 *
 * @module dsh-git-github
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { LocalGitHubService } from './service.js'

export { Config, type Config as GitHubConfig } from './config.js'
export { LocalGitHubService, type ServiceOptions } from './service.js'
export { GitHubClient, mapHttpError, redact, type GitHubClientOptions, type RequestOptions } from './client.js'
export {
  mapFile,
  mapIssue,
  mapIssueDetail,
  mapPull,
  mapPullDetail,
  mapRepo,
  parseRemoteUrl,
  summarizeChecks,
  truncatePatch,
  type RawCheckRuns,
  type RawFile,
  type RawIssue,
  type RawPull,
  type RawRepo,
} from './map.js'

/** 插件名。 */
export const name = 'dsh-git-github'

/** 依赖凭据服务；`ctx.git` 是可选的（只用于从 remote 推导 owner/repo）。 */
export const inject = ['credentials']

/**
 * 挂载 `ctx.github`。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  new LocalGitHubService(ctx, config)
}
