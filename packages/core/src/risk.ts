/**
 * `ctx.gitRisk`：dsh-git 自己的风险注册表。
 *
 * 工具包在**注册工具的同一行**登记风险，策略包只读这张表；两者之间没有直接依赖。
 * 之所以不靠工具名前缀匹配，是因为改名即可绕过策略（见 docs/08 ADR-007）。
 *
 * @module dsh-git-core/risk
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** 一个工具的风险等级。 */
export type ToolRisk = 'read' | 'write' | 'network-write'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitRisk: GitRiskService
  }
}

/** 一条风险登记。 */
export interface RiskEntry {
  tool: string
  risk: ToolRisk
  /** 一句话说明这个操作会改变什么，用于审批文案 */
  summary?: string
}

/**
 * 风险注册表服务。
 *
 * 重名登记直接抛错：静默覆盖会让策略作用于错误的工具。
 */
export class GitRiskService extends Service {
  private readonly table = new Map<string, RiskEntry>()

  constructor(ctx: Context) {
    super(ctx, 'gitRisk')
  }

  /** 登记一个工具的风险；同名重复登记抛错。 */
  register(entry: RiskEntry): void {
    if (this.table.has(entry.tool)) {
      throw new Error(`dsh-git: duplicate risk registration for tool "${entry.tool}"`)
    }
    this.table.set(entry.tool, entry)
  }

  /** 注销（工具卸载时调用）。 */
  unregister(tool: string): void {
    this.table.delete(tool)
  }

  /** 读取风险等级；未登记返回 undefined。 */
  get(tool: string): ToolRisk | undefined {
    return this.table.get(tool)?.risk
  }

  /** 读取完整登记；未登记返回 undefined。 */
  entry(tool: string): RiskEntry | undefined {
    return this.table.get(tool)
  }

  /** 全部登记的快照。 */
  entries(): RiskEntry[] {
    return [...this.table.values()]
  }

  /** 是否登记过该工具。 */
  has(tool: string): boolean {
    return this.table.has(tool)
  }
}
