/**
 * dsh-git bundle 的运行时入口。
 *
 * bundle 本身不注册任何东西：它的价值全在 `cordis.patch.yml` 里（见同目录）。
 * 这个入口存在的理由有两个：
 * 1. `main` / `types` 指向真实文件，避免解析器在 `dsh plugin add` 时踩到空指针；
 * 2. 给 `dsh plugin why dsh-git` 之类的诊断一个可读的版本出口。
 *
 * @module dsh-git
 */

/** bundle 名（与 package name 一致）。 */
export const name = 'dsh-git'

/** 本 bundle 组合的插件行 id，顺序与 `cordis.patch.yml` 一致。 */
export const entries = [
  'dsh-git-core',
  'dsh-git-local',
  'dsh-git-policy',
  'dsh-git-tool-git',
  'dsh-git-github',
  'dsh-git-tool-github',
  'dsh-git-client',
] as const

/** v0.1 已实现、默认启用的行（bundle 里全部 7 行都已启用）。 */
export const enabledEntries = entries.filter(() => true)
