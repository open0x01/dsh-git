/**
 * dsh-git-tool-git：本地 Git 的模型工具。
 *
 * v0.1 注册 11 个工具：5 个只读 + 6 个写（写操作由 `dsh-git-policy` 走审批）。
 * 网络工具（fetch / pull / push）默认不注册——Provider 也没有对应方法（`enableNetwork: false`）。
 *
 * @module dsh-git-tool-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerBlameTool } from './tools/blame.js'
import { registerBranchTool } from './tools/branch.js'
import { registerCommitTool } from './tools/commit.js'
import { registerDiffTool } from './tools/diff.js'
import { registerLogTool } from './tools/log.js'
import { registerShowTool } from './tools/show.js'
import { registerStageTool } from './tools/stage.js'
import { registerStashTool } from './tools/stash.js'
import { registerStatusTool } from './tools/status.js'
import { registerUnstageTool } from './tools/unstage.js'
import { registerWorktreeTool } from './tools/worktree.js'

/** 配置。 */
export interface Config {
  /** 统一工具名前缀，用于与其他插件共存（例如 `dshgit_`） */
  toolPrefix: string
  /** 是否注册 6 个写工具（stage / unstage / commit / branch / stash / worktree） */
  enableWriteTools: boolean
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  toolPrefix: z
    .string()
    .default('')
    .description('统一工具名前缀；与生态插件同装且重名时用它避让'),
  enableWriteTools: z
    .boolean()
    .default(true)
    .description('是否注册写工具；关闭后模型只能读，不能改仓库'),
})

/** 插件名。 */
export const name = 'dsh-git-tool-git'

/** 依赖：工具注册表、git 服务、风险注册表（工作目录服务是可选的，见 support.ts）。 */
export const inject = ['tools', 'git', 'gitRisk']

/** 已注册的工具名（按注册顺序）。 */
export const toolNames = [
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'git_blame',
  'git_stage',
  'git_unstage',
  'git_commit',
  'git_branch',
  'git_stash',
  'git_worktree',
] as const

/**
 * 注册全部本地 git 工具。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置
 */
export function apply(ctx: Context, config: Config): void {
  const prefix = config.toolPrefix ?? ''

  registerStatusTool(ctx, prefix)
  registerDiffTool(ctx, prefix)
  registerLogTool(ctx, prefix)
  registerShowTool(ctx, prefix)
  registerBlameTool(ctx, prefix)

  if (config.enableWriteTools !== false) {
    registerStageTool(ctx, prefix)
    registerUnstageTool(ctx, prefix)
    registerCommitTool(ctx, prefix)
    registerBranchTool(ctx, prefix)
    registerStashTool(ctx, prefix)
    registerWorktreeTool(ctx, prefix)
  }
}
