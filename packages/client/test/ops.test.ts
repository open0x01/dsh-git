import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalGitService, Config as LocalConfig } from '../../local/src/index.ts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRouteHandler } from '../src/host/routes.js'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

let repoRoot = ''
let baseUrl = ''
let server: ReturnType<typeof createServer>

/** 起一个只跑 RPC 路由的真实 HTTP 服务。 */
beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-git-client-'))
  repoRoot = join(base, 'repo')
  await writeFile(join(base, 'placeholder.txt'), '', 'utf8').catch(() => {})
  execFileSync('git', ['init', '-b', 'main', repoRoot], { encoding: 'utf8' })
  git(repoRoot, 'config', 'user.name', 'Test User')
  git(repoRoot, 'config', 'user.email', 'test@example.com')
  await writeFile(join(repoRoot, 'a.txt'), 'one\n', 'utf8')
  git(repoRoot, 'add', '-A')
  git(repoRoot, 'commit', '-m', 'chore: 初始提交')

  const ctx = new Context()
  new LocalGitService(ctx, LocalConfig({ timeoutMs: 20_000, maxOutputBytes: 1_000_000 }) as never)

  server = createServer(createRouteHandler({ ctx, maxCommits: 20 }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('无法取得测试端口')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()))
  if (repoRoot !== '') await rm(join(repoRoot, '..'), { recursive: true, force: true })
})

/** 发一次 RPC。 */
async function rpc(op: string, body: unknown = {}, method = 'POST') {
  const response = await fetch(`${baseUrl}/api/dsh-git/${op}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('面板 RPC（真实 HTTP + 真实 git）', () => {
  it('snapshot 返回仓库、状态与最近提交', async () => {
    const result = await rpc('snapshot', { repoDir: repoRoot })
    expect(result.status).toBe(200)
    const data = result.body.data as {
      repo: { branch: string }
      status: { staged: unknown[]; unstaged: unknown[]; untracked: unknown[] }
      commits: Array<{ subject: string }>
    }
    expect(data.repo.branch).toBe('main')
    expect(data.commits[0]?.subject).toBe('chore: 初始提交')
    expect(data.status.staged).toHaveLength(0)
  })

  it('branches 与 worktrees 走同一套校验', async () => {
    const branches = await rpc('branches', { repoDir: repoRoot })
    expect(branches.status).toBe(200)
    const list = (branches.body.data as { branches: Array<{ name: string; current: boolean }> }).branches
    expect(list.find((branch) => branch.current)?.name).toBe('main')

    const worktrees = await rpc('worktrees', { repoDir: repoRoot })
    expect(worktrees.status).toBe(200)
    expect((worktrees.body.data as { worktrees: unknown[] }).worktrees).toHaveLength(1)
  })

  it('写 op 返回 501 并提示走模型工具', async () => {
    const result = await rpc('commit', { repoDir: repoRoot, message: 'x' })
    expect(result.status).toBe(501)
    expect((result.body.error as { code: string }).code).toBe('write-not-available')
    expect((result.body.error as { hint?: string }).hint).toContain('模型工具')
  })

  it('未知 op 返回 404', async () => {
    const result = await rpc('rm-rf', { repoDir: repoRoot })
    expect(result.status).toBe(404)
    expect((result.body.error as { code: string }).code).toBe('unknown-op')
  })

  it('非 POST 返回 405', async () => {
    const result = await rpc('snapshot', {}, 'GET')
    expect(result.status).toBe(405)
  })

  it('非法 JSON 返回 400', async () => {
    const result = await rpc('snapshot', '{ not json')
    expect(result.status).toBe(400)
    expect((result.body.error as { code: string }).code).toBe('invalid-body')
  })

  it('非仓库目录返回 400 且带 code', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-git-client-norepo-'))
    const result = await rpc('snapshot', { repoDir: outside })
    expect(result.status).toBe(400)
    expect((result.body.error as { code: string }).code).toBe('not-a-repo')
    await rm(outside, { recursive: true, force: true })
  })
})
