/**
 * dsh-git 的服务定义包。
 *
 * 这里只放**抽象与类型**，外加一个极小的运行时服务 `ctx.gitRisk`
 * （工具包与策略包共享的风险注册表，见 docs/08 ADR-007）。
 *
 * @module dsh-git-core
 */

import type { Context } from '@deepseek-ai/cordis'
import { GitRiskService } from './risk.js'

export * from './errors.js'
export * from './types.js'
export * from './git.js'
export * from './github.js'
export * from './risk.js'

/** 插件名。 */
export const name = 'dsh-git-core'

/** 不依赖任何其他服务。 */
export const inject: string[] = []

/**
 * 挂载 `ctx.gitRisk`。
 *
 * core 是定义包，绝大多数消费者只用它的类型；但风险注册表必须是**同一个实例**，
 * 所以它作为唯一一行运行时内容由 core 自己提供。
 */
export function apply(ctx: Context): void {
  new GitRiskService(ctx)
}
