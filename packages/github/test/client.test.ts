import { describe, expect, it, vi } from 'vitest'
import { GitHubClient, mapHttpError, redact } from '../src/client.js'

/** 造一个最小可用的 Response。 */
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function client(fetchImpl: typeof globalThis.fetch, overrides: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) {
  return new GitHubClient({
    baseUrl: 'https://api.github.com',
    token: 'ghp_secret_token_value_1234567890',
    timeoutMs: 1_000,
    cacheTtlMs: 0,
    userAgent: 'dsh-git-test',
    retries: 0,
    fetchImpl,
    ...overrides,
  })
}

describe('GitHubClient', () => {
  it('发出带认证头的请求并解析 JSON', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toContain('Bearer ghp_')
      expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28')
      expect(headers.get('User-Agent')).toBe('dsh-git-test')
      return jsonResponse({ login: 'octocat' })
    })

    const result = await client(fetchImpl as unknown as typeof globalThis.fetch).json<{ login: string }>('/user')
    expect(result.data.login).toBe('octocat')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('拼 query 参数', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('state=open')
      expect(String(url)).toContain('per_page=5')
      return jsonResponse([])
    })
    await client(fetchImpl as unknown as typeof globalThis.fetch).json('/repos/o/r/pulls', {
      query: { state: 'open', per_page: 5, ignored: undefined },
    })
  })

  it('TTL 内的 GET 直接命中缓存，不再发请求', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, { headers: { etag: 'W/"1"' } }))
    const instance = client(fetchImpl as unknown as typeof globalThis.fetch, { cacheTtlMs: 10_000 })

    await instance.json('/repos/o/r')
    const second = await instance.json<{ ok: boolean }>('/repos/o/r')

    expect(second.data.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('TTL 过期后带 If-None-Match，304 时复用缓存', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }, { headers: { etag: 'W/"abc"' } }))
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('If-None-Match')).toBe('W/"abc"')
        return new Response(null, { status: 304 })
      })

    const instance = client(fetchImpl as unknown as typeof globalThis.fetch, { cacheTtlMs: 0 })
    await instance.json('/repos/o/r')
    const second = await instance.json<{ ok: number }>('/repos/o/r')
    expect(second.data.ok).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('401 映射为 auth-missing，且消息里不含 token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    const error = await client(fetchImpl as unknown as typeof globalThis.fetch)
      .json('/user')
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'auth-missing' })
    expect(String((error as Error).message)).not.toContain('ghp_secret')
  })

  it('403 + 剩余配额 0 映射为 rate-limited 并带重置时间', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } },
      ),
    )
    const error = await client(fetchImpl as unknown as typeof globalThis.fetch)
      .json('/repos/o/r')
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'rate-limited' })
    expect((error as { detail: { hint?: string } }).detail.hint).toContain('重置')
  })

  it('404 映射为 invalid-ref', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Not Found' }, { status: 404 }))
    const error = await client(fetchImpl as unknown as typeof globalThis.fetch)
      .json('/repos/o/missing')
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'invalid-ref' })
  })

  it('5xx 会按 retries 重试，重试成功则返回结果', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const instance = client(fetchImpl as unknown as typeof globalThis.fetch, { retries: 1 })
    const result = await instance.json<{ ok: boolean }>('/repos/o/r')
    expect(result.data.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('超时映射为 timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const error = await client(fetchImpl as unknown as typeof globalThis.fetch, { timeoutMs: 20 })
      .json('/repos/o/r')
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'timeout' })
  })

  it('取消信号会中止请求', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          controller.abort()
        }),
    )
    const error = await client(fetchImpl as unknown as typeof globalThis.fetch)
      .json('/repos/o/r', { signal: controller.signal })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'command-failed' })
  })

  it('text() 返回原始文本（diff）且不缓存', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('Accept')).toBe('application/vnd.github.v3.diff')
        return new Response('diff --git a/x b/x\n+1\n', { status: 200 })
      },
    )
    const instance = client(fetchImpl as unknown as typeof globalThis.fetch, { cacheTtlMs: 10_000 })
    const first = await instance.text('/repos/o/r/pulls/1', { accept: 'application/vnd.github.v3.diff' })
    await instance.text('/repos/o/r/pulls/1', { accept: 'application/vnd.github.v3.diff' })
    expect(first.data).toContain('diff --git')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('redact / mapHttpError', () => {
  it('抹掉 token 与常见凭据形态', () => {
    expect(redact('token=ghp_abcdefghijklmnopqrst', '')).not.toContain('ghp_abcdefghijklmnopqrst')
    expect(redact('Authorization: Bearer abcdefghijklmn', '')).toContain('Bearer ***')
    expect(redact('mine: ghp_zzzzzzzzzzzzzzzzzzzz', 'ghp_zzzzzzzzzzzzzzzzzzzz')).not.toContain('ghp_zzzz')
  })

  it('422 归为 command-failed 并带状态码', () => {
    const error = mapHttpError(422, JSON.stringify({ message: 'Validation Failed' }), new Headers(), '/pulls', '')
    expect(error.code).toBe('command-failed')
    expect(error.detail.exitCode).toBe(422)
  })
})
