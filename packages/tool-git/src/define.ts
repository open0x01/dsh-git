/**
 * 工具注册助手：**注册即登记风险**。
 *
 * 风险表与工具注册同源，改名不会绕过策略；策略包只读 `ctx.gitRisk`，
 * 因此工具包与策略包之间没有直接依赖（docs/08 ADR-007）。
 *
 * 用法：`registerGitTool(ctx, 'read', '……', defineTool({ ... }))`
 * —— 由调用点负责 `defineTool` 的类型推断，这里只做登记与注册，
 * 避免泛型在包装层重复实例化（TS 会在深层 schema 上爆栈）。
 *
 * @module dsh-git-tool-git/define
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolRisk } from 'dsh-git-core'

/**
 * 注册一个 dsh-git 工具并登记风险。
 *
 * @param ctx - 插件上下文（需已注入 `tools` 与 `gitRisk`）
 * @param risk - 风险等级
 * @param summary - 审批文案里的一句话说明
 * @param definition - `defineTool(...)` 的产物
 * @returns 注册 disposer（随插件 fiber 卸载）
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
