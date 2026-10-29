/**
 * dsh-git-tool-github：GitHub 的模型工具（8 个 `gh_*`）。
 *
 * 命名分域（docs/08 ADR-004）：GitHub 工具一律 `gh_*`，避开生态插件对 `github_*` 的占用；
 * `toolPrefix` 可再统一加前缀。`gh_pr_create` 是 network-write，策略默认 `deny`。
 *
 * @module dsh-git-tool-github
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerAuthStatusTool } from './tools/auth.js'
import { registerIssueTools } from './tools/issues.js'
import { registerPullTools } from './tools/pulls.js'
import { registerRepoViewTool } from './tools/repo.js'

/** 配置。 */
export interface Config {
  /** 统一工具名前缀 */
  toolPrefix: string
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  toolPrefix: z.string().default('').description('统一工具名前缀'),
})

/** 插件名。 */
export const name = 'dsh-git-tool-github'

/** 依赖：工具注册表、github 服务、风险注册表；`ctx.git` 可选（用于从 remote 推导 slug）。 */
export const inject = ['tools', 'github', 'gitRisk']

/** 已注册的工具名（按注册顺序）。 */
export const toolNames = [
  'gh_auth_status',
  'gh_repo_view',
  'gh_pr_list',
  'gh_pr_view',
  'gh_pr_diff',
  'gh_pr_create',
  'gh_issue_list',
  'gh_issue_view',
] as const

/**
 * 注册 8 个 GitHub 工具。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  const prefix = config.toolPrefix ?? ''
  registerAuthStatusTool(ctx, prefix)
  registerRepoViewTool(ctx, prefix)
  registerPullTools(ctx, prefix)
  registerIssueTools(ctx, prefix)
}
