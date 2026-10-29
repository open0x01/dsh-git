import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.js'
import { LocalGitHubService } from '../src/service.js'

/** 用 schemastery 的默认值构造配置，避免手写全部字段。 */
function config(overrides: Partial<typeof Config> = {}): Record<string, unknown> {
  return { ...(Config as unknown as { (value: unknown): unknown })(overrides) } as Record<string, unknown>
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

/** 建一个挂在真实 cordis Context 上的服务（注入 fetch 与 token）。 */
function makeService(fetchImpl: typeof globalThis.fetch, token: string | null = 'ghp_test_token_1234567890') {
  const ctx = new Context()
  const service = new LocalGitHubService(
    ctx,
    config() as never,
    { fetchImpl, tokenProvider: async () => token ?? undefined },
  )
  return { ctx, service }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalGitHubService', () => {
  it('authStatus：有 token 时返回登录名与 scopes', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ login: 'octocat' }, { headers: { 'x-oauth-scopes': 'repo, read:org' } }),
    )
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)

    await expect(service.authStatus()).resolves.toEqual({
      configured: true,
      login: 'octocat',
      scopes: ['repo', 'read:org'],
    })
  })

  it('authStatus：缺 token 时返回 configured=false 与可执行提示，而不是抛错', async () => {
    const fetchImpl = vi.fn(async () => json({ login: 'never-called' }))
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch, null)

    const status = await service.authStatus()
    expect(status.configured).toBe(false)
    expect(status.scopes).toEqual([])
    expect(status.hint).toBeDefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('authStatus：token 无效时也是 configured=false', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'Bad credentials' }, { status: 401 }))
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const status = await service.authStatus()
    expect(status.configured).toBe(false)
    expect(status.hint).toContain('认证失败')
  })

  it('listPulls 请求正确的路径与参数', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url)
      expect(text).toContain('/repos/o/r/pulls')
      expect(text).toContain('state=open')
      expect(text).toContain('per_page=5')
      return json([
        { number: 1, title: 'a', state: 'open', head: { ref: 'f' }, base: { ref: 'main' } },
        { number: 2, title: 'b', state: 'closed', merged_at: '2026-01-01T00:00:00Z' },
      ])
    })
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const pulls = await service.listPulls({ owner: 'o', repo: 'r' }, { limit: 5 })

    expect(pulls).toHaveLength(2)
    expect(pulls[1]?.state).toBe('merged')
  })

  it('getPull 合并详情、文件与 checks；checks 失败不影响主结果', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const text = String(url)
      if (text.includes('/pulls/9/files')) {
        return json([{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }])
      }
      if (text.includes('/check-runs')) return json({ message: 'forbidden' }, { status: 403 })
      if (text.includes('/pulls/9')) {
        return json({
          number: 9,
          title: 'feat',
          state: 'open',
          head: { ref: 'f', sha: 'abc' },
          base: { ref: 'main' },
          changed_files: 1,
        })
      }
      return json({})
    })
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const pull = await service.getPull({ owner: 'o', repo: 'r' }, 9)

    expect(pull.number).toBe(9)
    expect(pull.files).toHaveLength(1)
    expect(pull.checks).toBeUndefined()
  })

  it('pullDiff 用 diff 的 Accept 头，并按 maxDiffBytes 截断', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url)
      if (text.includes('/files')) return json([{ filename: 'a.ts', status: 'added' }])
      expect(new Headers(init?.headers).get('Accept')).toBe('application/vnd.github.v3.diff')
      return new Response('diff --git a/a.ts b/a.ts\n+1\n', { status: 200 })
    })
    const ctx = new Context()
    const service = new LocalGitHubService(ctx, config({ maxDiffBytes: 10 }) as never, {
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      tokenProvider: async () => 'ghp_x_1234567890',
    })

    const diff = await service.pullDiff({ owner: 'o', repo: 'r' }, 3)
    expect(diff.files.map((file) => file.status)).toEqual(['added'])
    expect(diff.truncated).toBe(true)
  })

  it('createPull 默认 draft=true 并 POST 到 /pulls', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/repos/o/r/pulls')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toMatchObject({ title: 't', head: 'h', base: 'main', draft: true })
      return json({ number: 5, title: 't', state: 'open', draft: true, html_url: 'https://x/5' })
    })
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const pull = await service.createPull({ owner: 'o', repo: 'r' }, { title: 't', head: 'h', base: 'main' })

    expect(pull.number).toBe(5)
    expect(pull.draft).toBe(true)
  })

  it('listIssues 过滤掉其实是 PR 的条目', async () => {
    const fetchImpl = vi.fn(async () =>
      json([
        { number: 1, title: 'issue', state: 'open' },
        { number: 2, title: 'pr', state: 'open', pull_request: { url: 'x' } },
      ]),
    )
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const issues = await service.listIssues({ owner: 'o', repo: 'r' })
    expect(issues.map((issue) => issue.number)).toEqual([1])
  })

  it('getIssue 返回正文', async () => {
    const fetchImpl = vi.fn(async () => json({ number: 3, title: 'x', state: 'closed', body: '正文' }))
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const issue = await service.getIssue({ owner: 'o', repo: 'r' }, 3)
    expect(issue.body).toBe('正文')
  })

  it('repoView 映射默认分支与权限', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ name: 'r', full_name: 'o/r', default_branch: 'trunk', permissions: { push: true } }),
    )
    const { service } = makeService(fetchImpl as unknown as typeof globalThis.fetch)
    const view = await service.repoView({ owner: 'o', repo: 'r' })
    expect(view.defaultBranch).toBe('trunk')
    expect(view.permissions.push).toBe(true)
  })
})
