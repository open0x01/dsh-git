/**
 * 本地 Provider 的配置项。每个值都是部署间可能不同的量，因此都有 schema 默认值。
 *
 * @module dsh-git-local/config
 */

import z from '@deepseek-ai/schemastery'

/** `dsh-git-local` 的配置。 */
export interface Config {
  /** git 可执行文件；默认走 PATH */
  gitPath: string
  /** 单次命令超时（毫秒） */
  timeoutMs: number
  /** 文本输出上限（字节）；超出截断并标记 truncated */
  maxOutputBytes: number
  /** 允许操作的仓库根白名单（realpath 后比较）；空 = 不额外限制 */
  allowedRoots: string[]
  /** worktree 创建目录（相对仓库父目录） */
  worktreeRoot: string
  /** 是否允许 fetch/pull/push 这类网络操作 */
  enableNetwork: boolean
  /** 是否允许 commit --no-verify */
  allowNoVerify: boolean
  /** 默认远端名 */
  defaultRemote: string
  /** 追加给子进程的环境变量 */
  env: Record<string, string>
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  gitPath: z.string().default('git').description('git 可执行文件路径或命令名'),
  timeoutMs: z.number().default(20_000).description('单次 git 命令超时（毫秒）'),
  maxOutputBytes: z
    .number()
    .default(65_536)
    .description('单次命令的文本输出上限（字节），超出则截断'),
  allowedRoots: z
    .array(z.string())
    .default([])
    .description('允许操作的仓库根白名单；空表示不额外限制（仍受会话工作目录约束）'),
  worktreeRoot: z
    .string()
    .default('.worktrees')
    .description('git_worktree create 的落点（相对仓库父目录）'),
  enableNetwork: z
    .boolean()
    .default(false)
    .description('是否允许 fetch / pull / push（v0.1 默认关闭）'),
  allowNoVerify: z.boolean().default(false).description('是否允许 commit --no-verify'),
  defaultRemote: z.string().default('origin').description('默认远端名'),
  env: z.dict(z.string()).default({}).description('追加给 git 子进程的环境变量'),
})
