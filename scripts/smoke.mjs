/**
 * 冒烟脚本：不启动 GUI，直接把 dsh-git 的六个插件挂到一个真实的 cordis Context 上，
 * 断言 `ctx.git` / `ctx.github` / `ctx.gitRisk` / 19 个工具都到位。
 *
 *   pnpm build && pnpm smoke
 *
 * 全程不发网络请求：fetch 被替换成按 URL 路由的假实现，凭据由假 credentials 服务提供。
 * 这是 M0（能加载）、M1/M2（本地工具）、M3（GitHub 工具）的最小可重复验证，
 * 不依赖 dsh CLI、不写任何 profile。
 */

import { Context } from '@deepseek-ai/cordis'
import * as dshTools from '@deepseek-ai/dsh-tools'
import * as systemPrompt from '@deepseek-ai/dsh-system-prompt'
import { GitError } from 'dsh-git-core'
import * as core from '../packages/core/lib/index.js'
import * as github from '../packages/github/lib/index.js'
import * as local from '../packages/local/lib/index.js'
import * as policy from '../packages/policy/lib/index.js'
import * as toolGit from '../packages/tool-git/lib/index.js'
import * as toolGitHub from '../packages/tool-github/lib/index.js'

/** 假的 GitHub API：按路径返回固定 JSON。 */
function fakeFetch(url) {
  const path = new URL(String(url)).pathname
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo' },
    })

  if (path === '/user') return Promise.resolve(json({ login: 'smoke-user' }))
  if (path === '/repos/o/r') return Promise.resolve(json({ name: 'r', full_name: 'o/r', default_branch: 'main' }))
  if (path === '/repos/o/r/pulls') {
    return Promise.resolve(json([{ number: 1, title: 'smoke', state: 'open', head: { ref: 'f' }, base: { ref: 'main' } }]))
  }
  if (path === '/repos/o/r/pulls/1') return Promise.resolve(new Response('diff --git a/a b/a\n', { status: 200 }))
  if (path === '/repos/o/r/pulls/1/files') return Promise.resolve(json([{ filename: 'a', status: 'added' }]))
  if (path === '/repos/o/r/commits/abc/check-runs') return Promise.resolve(json({ total_count: 0, check_runs: [] }))
  if (path === '/repos/o/r/issues') return Promise.resolve(json([{ number: 2, title: 'issue', state: 'open' }]))
  if (path === '/repos/o/r/issues/2') return Promise.resolve(json({ number: 2, title: 'issue', state: 'open', body: 'b' }))
  return Promise.resolve(new Response(JSON.stringify({ message: 'unexpected ' + path }), { status: 404 }))
}

globalThis.fetch = fakeFetch

const ctx = new Context()

/** 假的凭据服务：只为冒烟提供 token，不碰真实凭据。 */
const fakeCredentials = {
  name: 'smoke-credentials',
  apply(inner) {
    const provide = (name, value) =>
      typeof inner.reflect?.provide === 'function'
        ? inner.reflect.provide(name, value)
        : inner.provide(name, value)
    provide('credentials', {
      resolve: async () => ({ value: 'ghp_smoke_token_1234567890', source: 'env' }),
      describe: async () => ({ configured: true, writable: true }),
      set: async () => {},
      unset: async () => {},
    })
  },
}

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
ctx.plugin(fakeCredentials)
ctx.plugin(asPlugin(core))
ctx.plugin(asPlugin(local), { timeoutMs: 20_000, maxOutputBytes: 65_536 })
ctx.plugin(asPlugin(policy), { rules: { read: 'allow', write: 'ask', 'network-write': 'deny' } })
ctx.plugin(asPlugin(toolGit), { toolPrefix: '' })
ctx.plugin(asPlugin(github), { tokenRef: 'GITHUB_TOKEN' })
ctx.plugin(asPlugin(toolGitHub), { toolPrefix: '' })

await new Promise((resolve) => setTimeout(resolve, 500))

const failures = []

if (ctx.get('git') === undefined) failures.push('ctx.git 没有挂载')
if (ctx.get('github') === undefined) failures.push('ctx.github 没有挂载')
if (ctx.get('gitRisk') === undefined) failures.push('ctx.gitRisk 没有挂载')
if (ctx.get('tools') === undefined) failures.push('ctx.tools 没有挂载')

const risks = ctx.get('gitRisk')?.entries() ?? []
const expectedRead = [
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'git_blame',
  'gh_auth_status',
  'gh_repo_view',
  'gh_pr_list',
  'gh_pr_view',
  'gh_pr_diff',
  'gh_issue_list',
  'gh_issue_view',
]
const expectedWrite = ['git_stage', 'git_unstage', 'git_commit', 'git_branch', 'git_stash', 'git_worktree']
const expectedNetworkWrite = ['gh_pr_create']

const registered = risks.map((entry) => entry.tool)
for (const name of [...expectedRead, ...expectedWrite, ...expectedNetworkWrite]) {
  if (!registered.includes(name)) failures.push(`风险表缺少 ${name}`)
}
for (const entry of risks) {
  const wanted = expectedRead.includes(entry.tool)
    ? 'read'
    : expectedWrite.includes(entry.tool)
      ? 'write'
      : 'network-write'
  if (entry.risk !== wanted) failures.push(`${entry.tool} 的风险是 ${entry.risk}，期望 ${wanted}`)
}

// 本地 git：非仓库目录必须被结构化拒绝
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

// GitHub：走一遍 authStatus / listPulls / pullDiff / listIssues
try {
  const status = await ctx.github.authStatus()
  if (status.configured !== true) failures.push('gh authStatus 未返回已配置')
  const pulls = await ctx.github.listPulls({ owner: 'o', repo: 'r' }, { limit: 5 })
  if (pulls.length !== 1) failures.push(`listPulls 返回 ${pulls.length} 条，期望 1`)
  const diff = await ctx.github.pullDiff({ owner: 'o', repo: 'r' }, 1)
  if (!diff.patch.includes('diff --git')) failures.push('pullDiff 没有返回补丁')
  const issues = await ctx.github.listIssues({ owner: 'o', repo: 'r' })
  if (issues.length !== 1) failures.push(`listIssues 返回 ${issues.length} 条，期望 1`)
  console.log(`✓ GitHub 链路可用（登录名 ${status.login ?? '未知'}）`)
} catch (error) {
  failures.push(`GitHub 链路失败：${String(error)}`)
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
