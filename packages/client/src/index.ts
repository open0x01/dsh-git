/**
 * dsh-git-client：Web 侧边栏 Git 面板。
 *
 * **状态：v0.1 里程碑 M4 尚未实现。** 本包目前刻意**不声明** `dsh.client`：
 * DSH 在 `dsh.client` 存在但 `exports["./client"]` 缺失时会直接报错，
 * 半成品声明比没有声明更糟。M4 的实现顺序写在 docs/04（T4.1 → T4.7）：
 *
 * 1. host 侧 `ctx.webServer.register({ kind: 'POST', path: '/api/dsh-git/<op>' })`，op 白名单；
 * 2. 客户端入口 `exports["./client"]` + `dsh.client = { platform: 'web', inject: [...] }`；
 * 3. 状态 / 提交 / 历史 / diff 四个视图，写操作复用 `ctx.git` 并标记 `source: 'ui'`。
 *
 * @module dsh-git-client
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** 配置。 */
export interface Config {
  /** 面板挂载位置 */
  slot: string
  /** 历史视图最多展示的提交数 */
  maxCommits: number
  /** 是否允许调用 LLM 生成提交说明 */
  enableAiCommitMessage: boolean
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  slot: z.string().default('right-sidebar').description('面板挂载位置'),
  maxCommits: z.number().default(200).description('历史视图最多展示的提交数'),
  enableAiCommitMessage: z.boolean().default(false).description('是否允许调用 LLM 生成提交说明'),
})

/** 插件名。 */
export const name = 'dsh-git-client'

/** 依赖：Web 服务器、git 与 github 服务。 */
export const inject = ['webServer', 'git']

/**
 * 占位：M4 会在这里注册 RPC 路由与客户端入口。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
  throw new Error(
    'dsh-git-client: Web 面板尚未实现（v0.1 里程碑 M4）。请在 profile 的 cordis.patch.yml 中把该行 disabled 置为 true。',
  )
}
