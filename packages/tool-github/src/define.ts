/**
 * 工具注册助手（与 `dsh-git-tool-git` 同构）：注册即登记风险。
 *
 * @module dsh-git-tool-github/define
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolRisk } from 'dsh-git-core'

/**
 * 注册一个 GitHub 工具并登记风险。
 *
 * @param ctx - 插件上下文
 * @param risk - 风险等级
 * @param summary - 审批文案里的一句话说明
 * @param definition - `defineTool(...)` 的产物
 * @returns 注册 disposer
 */
export function registerGitTool(
  ctx: Context,
  risk: ToolRisk,
  summary: string,
  definition: ToolDefinition,
): () => void {
  ctx.gitRisk.register({ tool: definition.name, risk, summary })
  return ctx.tools.register(definition)
}

/** 给工具名加上部署配置的前缀。 */
export function withPrefix(prefix: string, name: string): string {
  return prefix === '' ? name : `${prefix}${name}`
}
