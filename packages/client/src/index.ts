/**
 * dsh-git-client：Web 右侧边栏 Git 面板。
 *
 * **状态（v0.1）**：host 侧 RPC 已完成并通过测试；客户端 bundle 尚未发布，
 * 因此本包**刻意不声明** `dsh.client`（DSH 在声明了 `dsh.client` 却没有
 * `exports["./client"]` 时会直接报错，半成品声明比没有声明更糟）。
 *
 * host 侧提供只读 RPC：`POST /api/dsh-git/<op>`，op 白名单
 * `snapshot` / `branches` / `worktrees` / `pr`；写 op 返回 501 并提示走模型工具
 * （审批需要 agent 与进行中的 turn，HTTP 路由没有这个上下文，绕过审批就是后门）。
 *
 * @module dsh-git-client
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅为引入 dsh-host-webserver 对 Context 的声明合并（ctx.webServer）
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createRouteHandler, DEFAULT_RPC_PATH } from './host/routes.js'

/** `ctx.webServer` 的类型来源；仅用于类型位置。 */
export type { WebServer }

export { createRouteHandler, DEFAULT_RPC_PATH, MAX_BODY_BYTES, parseOp, readJsonBody } from './host/routes.js'
export {
  isOpName,
  READ_OPS,
  runOp,
  RpcError,
  toErrorResponse,
  WRITE_OPS,
  type OpName,
  type OpRequest,
} from './host/ops.js'

/** 配置。 */
export interface Config {
  /** RPC 路径前缀 */
  rpcPath: string
  /** 面板挂载位置（客户端 bundle 使用） */
  slot: string
  /** 历史视图最多展示的提交数 */
  maxCommits: number
  /** 是否允许调用 LLM 生成提交说明 */
  enableAiCommitMessage: boolean
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  rpcPath: z.string().default(DEFAULT_RPC_PATH).description('RPC 路径前缀'),
  slot: z.string().default('right-sidebar').description('面板挂载位置（客户端 bundle 使用）'),
  maxCommits: z.number().default(200).description('历史视图最多展示的提交数'),
  enableAiCommitMessage: z.boolean().default(false).description('是否允许调用 LLM 生成提交说明'),
})

/** 插件名。 */
export const name = 'dsh-git-client'

/** 依赖：Web 服务器与 git 服务；`github` 可选（`pr` op 用）。 */
export const inject = ['webServer', 'git']

/**
 * 注册只读 RPC 路由。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: config.rpcPath,
    handler: createRouteHandler({ ctx, maxCommits: config.maxCommits }),
  })
}
