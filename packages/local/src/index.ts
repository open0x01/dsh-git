/**
 * dsh-git-local：把 `ctx.git` 挂到本地 git 可执行文件上。
 *
 * @module dsh-git-local
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { LocalGitService } from './service.js'

export { Config, type Config as LocalConfig } from './config.js'
export { LocalGitService } from './service.js'
export { GIT_OUTPUT_CONFIG, gitEnv, runGit, runGitOk, type RunOptions, type RunResult } from './runner.js'
export { parseStatusV2 } from './status.js'
export { parseNameStatus, parseNumStat } from './diff.js'
export { parseLogLine, LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT } from './log.js'
export { parseBlamePorcelain } from './blame.js'
export { parseWorktreeList } from './write.js'
export { isInside, resolveInsideRepo, toRepoRelative, normalizePaths } from './paths.js'
export { resolveRepo, type ResolveContext } from './repo.js'

/** 插件名（与 package name 一致，便于日志定位）。 */
export const name = 'dsh-git-local'

/** 不依赖宿主服务：git 由子进程直接调用。 */
export const inject: string[] = []

/**
 * 挂载 `ctx.git`。
 *
 * @param ctx - 插件上下文
 * @param config - 部署配置（已有 schema 默认值）
 */
export function apply(ctx: Context, config: Config): void {
  new LocalGitService(ctx, config)
}
