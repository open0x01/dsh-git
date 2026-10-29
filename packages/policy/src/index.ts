/**
 * dsh-git-policy：把「风险登记」变成「审批决定」。
 *
 * 三条设计约束（docs/08 ADR-007）：
 * 1. 只处理 `ctx.gitRisk` 里登记过的工具——别的插件的工具一概 `next()` 放行；
 * 2. 不做任何命令文本匹配，因此不会与 `dsh-tool-git` 之类的闸门叠加成双重审批；
 * 3. 决定是纯函数（{@link decidePolicy}），可以脱离 cordis 单测。
 *
 * @module dsh-git-policy
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅为引入 dsh-tools 对 cordis Events 的声明合并（'tools/pre-execute'）
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type { ToolRisk } from 'dsh-git-core'

/** 单个风险等级的处置。 */
export type Decision = 'allow' | 'ask' | 'deny'

/** 配置。 */
export interface Config {
  rules: Record<ToolRisk, Decision>
  /** 精确到工具名的放行例外 */
  allowTools: string[]
  /** 精确到工具名的拒绝例外（优先级最高） */
  denyTools: string[]
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  rules: z
    .object({
      read: z.union(['allow', 'ask', 'deny'] as const).default('allow'),
      write: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
      'network-write': z.union(['allow', 'ask', 'deny'] as const).default('deny'),
    })
    .default({ read: 'allow', write: 'ask', 'network-write': 'deny' })
    .description('按风险等级给出的默认处置'),
  allowTools: z.array(z.string()).default([]).description('始终放行的工具名'),
  denyTools: z.array(z.string()).default([]).description('始终拒绝的工具名（优先级最高）'),
})

/** 一次策略判断的结果。 */
export interface PolicyDecision {
  decision: Decision
  /** 决定来源，便于排查「为什么这次没弹审批」 */
  source: 'denyTools' | 'allowTools' | 'rule' | 'unknown-tool'
}

/**
 * 纯函数：给定配置与工具，给出处置。
 *
 * @param config - 策略配置
 * @param toolName - 工具名
 * @param risk - 风险等级（`undefined` 表示未登记，不归本插件管）
 * @returns 决定与来源
 */
export function decidePolicy(
  config: Pick<Config, 'rules' | 'allowTools' | 'denyTools'>,
  toolName: string,
  risk: ToolRisk | undefined,
): PolicyDecision {
  if (risk === undefined) return { decision: 'allow', source: 'unknown-tool' }
  if (config.denyTools.includes(toolName)) return { decision: 'deny', source: 'denyTools' }
  if (config.allowTools.includes(toolName)) return { decision: 'allow', source: 'allowTools' }
  return { decision: config.rules[risk], source: 'rule' }
}

/** 插件名。 */
export const name = 'dsh-git-policy'

/** 依赖风险表与工具注册表（`tools` 提供 pre-execute 事件）。 */
export const inject = ['tools', 'gitRisk']

/**
 * 挂载 `tools/pre-execute` 闸门。
 *
 * `ask` 交给宿主的审批通道处理：没有 agent、没有审批器时宿主会自动降级为拒绝，
 * 这正是我们要的 fail-closed 行为。
 *
 * @param ctx - 插件上下文
 * @param config - 策略配置
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on(
    'tools/pre-execute',
    async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
      const risk = ctx.gitRisk.get(exec.name)
      const decision = decidePolicy(config, exec.name, risk)
      if (decision.source === 'unknown-tool' || decision.decision === 'allow') {
        return next()
      }

      const entry = ctx.gitRisk.entry(exec.name)
      const label = risk === undefined ? '未知风险' : riskLabel(risk)
      const summary = entry?.summary ?? '该操作会修改仓库'

      if (decision.decision === 'deny') {
        return {
          kind: 'deny',
          reason: `dsh-git 策略拒绝 ${label} 操作 ${exec.name}：${summary}（rules.${risk ?? 'unknown'} = deny）`,
        }
      }

      return {
        kind: 'ask',
        reason: `${label}操作 ${exec.name}：${summary}`,
        displayReason: {
          en: `Run ${label} git operation "${exec.name}": ${summary}`,
          zh: `执行 ${label} git 操作「${exec.name}」：${summary}`,
        },
      }
    },
  )
}

/**
 * 风险等级的中文标签，用于审批文案。
 *
 * @param risk - 风险等级
 * @returns 中文短语
 */
function riskLabel(risk: ToolRisk): string {
  switch (risk) {
    case 'read':
      return '只读'
    case 'write':
      return '写入'
    case 'network-write':
      return '联网写入'
  }
}
