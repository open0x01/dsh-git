/**
 * dsh-git-tool-github：GitHub 的模型工具。
 *
 * **状态：v0.1 里程碑 M3 尚未实现。** 计划注册 8 个工具：
 * `gh_auth_status`、`gh_repo_view`、`gh_pr_list`、`gh_pr_view`、`gh_pr_diff`、
 * `gh_pr_create`（默认 draft）、`gh_issue_list`、`gh_issue_view`。
 *
 * 命名分域（docs/08 ADR-004）：GitHub 工具一律 `gh_*`，避开生态插件对 `github_*` 的占用；
 * `toolPrefix` 可再统一加前缀。
 *
 * @module dsh-git-tool-github
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

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

/** 依赖：工具注册表、github 服务、风险注册表。 */
export const inject = ['tools', 'github', 'gitRisk']

/**
 * 占位：M3 会在这里注册 8 个 `gh_*` 工具。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
  throw new Error(
    'dsh-git-tool-github: GitHub 工具尚未实现（v0.1 里程碑 M3）。请在 profile 的 cordis.patch.yml 中把该行 disabled 置为 true。',
  )
}
