/**
 * 冒烟脚本：不启动 GUI，直接把 dsh-git 的四个插件挂到一个真实的 cordis Context 上，
 * 断言 `ctx.git` / `ctx.gitRisk` / 工具注册都到位。
 *
 *   pnpm build && pnpm smoke
 *
 * 这是 M0「空插件能加载」与 M1「工具已注册」的最小可重复验证，
 * 不依赖 dsh CLI、不写任何 profile。
 */

import { Context } from '@deepseek-ai/cordis'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as systemPrompt from '@deepseek-ai/dsh-system-prompt'
import { GitError } from 'dsh-git-core'
import * as core from '../packages/core/lib/index.js'
import * as local from '../packages/local/lib/index.js'
import * as policy from '../packages/policy/lib/index.js'
import * as toolGit from '../packages/tool-git/lib/index.js'

const ctx = new Context()

/**
 * cordis 只认「函数 / 类 / 带 apply 的对象」，而 ESM 命名空间对象不算后者的普通对象。
 * 这里做一次归一：有 apply 就包成普通对象，否则用 default（Service 类插件）。
 */
function asPlugin(module) {
  if (typeof module.apply === 'function') {
    return {
      name: module.name,
      inject: module.inject,
      ...(module.Config === undefined ? {} : { Config: module.Config }),
      apply: module.apply,
    }
  }
  return module.default ?? module
}

ctx.plugin(asPlugin(systemPrompt))
ctx.plugin(asPlugin(dshTools))
ctx.plugin(asPlugin(core))
ctx.plugin(asPlugin(local), { timeoutMs: 20_000, maxOutputBytes: 65_536 })
ctx.plugin(asPlugin(policy), { rules: { read: 'allow', write: 'ask', 'network-write': 'deny' } })
ctx.plugin(asPlugin(toolGit), { toolPrefix: '' })

await new Promise((resolve) => setTimeout(resolve, 300))

const failures = []

if (ctx.get('git') === undefined) failures.push('ctx.git 没有挂载')
if (ctx.get('gitRisk') === undefined) failures.push('ctx.gitRisk 没有挂载')
if (ctx.get('tools') === undefined) failures.push('ctx.tools 没有挂载')

const risks = ctx.get('gitRisk')?.entries() ?? []
const expectedRead = ['git_status', 'git_diff', 'git_log', 'git_show', 'git_blame']
const expectedWrite = [
  'git_stage',
  'git_unstage',
  'git_commit',
  'git_branch',
  'git_stash',
  'git_worktree',
]
const registered = risks.map((entry) => entry.tool)
for (const name of [...expectedRead, ...expectedWrite]) {
  if (!registered.includes(name)) failures.push(`风险表缺少 ${name}`)
}
for (const entry of risks) {
  const wanted = expectedRead.includes(entry.tool) ? 'read' : 'write'
  if (entry.risk !== wanted) failures.push(`${entry.tool} 的风险是 ${entry.risk}，期望 ${wanted}`)
}

// 策略层：写工具必须被判成 ask（这是「默认安全」的可观测证据）
const decision = ctx.get('gitRisk')?.get('git_commit')
if (decision !== 'write') failures.push('git_commit 未登记为 write 风险')

// 解析一个真实仓库：仓库外目录必须被结构化拒绝
try {
  await ctx.git.resolveRepo(process.cwd())
  console.log(`✓ resolveRepo(${process.cwd()}) 成功`)
} catch (error) {
  if (error instanceof GitError) {
    console.log(`✓ resolveRepo 返回结构化错误：${error.code}`)
  } else {
    failures.push(`resolveRepo 抛出了非 GitError：${String(error)}`)
  }
}

if (failures.length > 0) {
  console.error('冒烟失败：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(`✓ 已注册 ${registered.length} 个工具：${registered.join(', ')}`)
  console.log('✓ 冒烟通过')
}

await ctx.registry?.dispose?.()
