/**
 * GitHub REST 客户端：只用 `fetch`，零第三方依赖。
 *
 * 负责四件事，其余（映射、业务）都在上层：
 * 1. 认证头与固定 header（API 版本、User-Agent）；
 * 2. 超时与取消（`AbortController`，不依赖 `AbortSignal.timeout` 的平台差异）；
 * 3. ETag 缓存 + TTL（读操作省配额）；
 * 4. 状态码 → `GitError` 的映射，并对消息里的 token 做脱敏。
 *
 * @module dsh-git-github/client
 */

import { GitError } from 'dsh-git-core'

/** 客户端配置。 */
export interface GitHubClientOptions {
  /** 例如 https://api.github.com */
  baseUrl: string
  /** 已解析的 token（由 ctx.credentials 每次操作现取） */
  token: string
  timeoutMs: number
  cacheTtlMs: number
  userAgent: string
  /** 5xx / 网络错误的重试次数（默认 1） */
  retries: number
  /** 注入点：测试用假的 fetch */
  fetchImpl?: typeof globalThis.fetch
}

/** 一次请求的可选参数。 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Accept 头；拉 diff 时用 `application/vnd.github.v3.diff` */
  accept?: string
  signal?: AbortSignal
  /** 是否参与 ETag 缓存（默认 GET 为 true） */
  cache?: boolean
}

/** 一次请求的结果。 */
export interface GitHubResponse<T> {
  data: T
  status: number
  headers: Headers
}

/** 缓存条目。 */
interface CacheEntry {
  etag: string
  data: unknown
  storedAt: number
}

/** GitHub 的 JSON 错误体。 */
interface ErrorBody {
  message?: string
  documentation_url?: string
  errors?: unknown
}

/**
 * 把 token 与常见凭据形态从文本里抹掉。
 *
 * @param text - 任意文本
 * @param token - 本次使用的 token（可为空）
 * @returns 脱敏后的文本
 */
export function redact(text: string, token: string): string {
  let result = text
  if (token !== '') result = result.split(token).join('***')
  return result
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '***')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer ***')
}

/**
 * 把 HTTP 失败映射成结构化错误。
 *
 * @param status - HTTP 状态码
 * @param body - 响应体（可能不是 JSON）
 * @param headers - 响应头
 * @param path - 请求路径（用于报错定位）
 * @param token - 本次 token（用于脱敏）
 * @returns 结构化错误
 */
export function mapHttpError(
  status: number,
  body: string,
  headers: Headers,
  path: string,
  token: string,
): GitError {
  let message = ''
  try {
    const parsed = JSON.parse(body) as ErrorBody
    message = typeof parsed.message === 'string' ? parsed.message : ''
  } catch {
    message = body.slice(0, 200)
  }
  message = redact(message, token)

  const remaining = headers.get('x-ratelimit-remaining')
  const retryAfter = headers.get('retry-after')
  const reset = Number(headers.get('x-ratelimit-reset') ?? '0')
  const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : undefined

  if (status === 401) {
    return new GitError('auth-missing', `GitHub 认证失败：${message || 'token 无效或已过期'}`, {
      hint: '检查 tokenRef 指向的凭据是否有效（环境变量或 DSH 凭据），换 token 后无需重启插件',
    })
  }

  if ((status === 403 || status === 429) && (remaining === '0' || retryAfter !== null)) {
    return new GitError('rate-limited', `GitHub 触发限流：${message || '请求过于频繁'}`, {
      ...(resetAt === undefined ? {} : { hint: `配额将在 ${resetAt} 重置` }),
    })
  }

  if (status === 403) {
    return new GitError('auth-missing', `GitHub 拒绝访问：${message || 'token 权限不足'}`, {
      hint: '确认 token 具备 repo（或 public_repo）与必要的 read 权限',
    })
  }

  if (status === 404) {
    return new GitError('invalid-ref', `GitHub 资源不存在：${path}`, {
      hint: '确认 owner/repo 与编号正确；私有仓库还需要 token 有访问权',
    })
  }

  if (status >= 500) {
    return new GitError('network', `GitHub 服务端错误（${status}）：${message || '未知错误'}`, {
      exitCode: status,
      hint: '稍后重试；持续失败可在配置里调大 retries / timeoutMs',
    })
  }

  return new GitError('command-failed', `GitHub 请求失败（${status}）：${message || '未知错误'}`, {
    exitCode: status,
  })
}

/**
 * 极简 GitHub 客户端。
 */
export class GitHubClient {
  private readonly options: GitHubClientOptions
  private readonly cache = new Map<string, CacheEntry>()

  constructor(options: GitHubClientOptions) {
    this.options = options
  }

  /** 拼接 URL。 */
  private url(path: string, query?: RequestOptions['query']): string {
    const base = this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`
    const url = new URL(path.replace(/^\//, ''), base)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  /** 统一 header。 */
  private headers(options: RequestOptions, etag?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/vnd.github+json',
      Authorization: `Bearer ${this.options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.options.userAgent,
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (etag !== undefined) headers['If-None-Match'] = etag
    return headers
  }

  /**
   * 发一次请求并返回文本（内部实现，JSON 与 diff 共用）。
   *
   * @param path - 相对 baseUrl 的路径
   * @param options - 请求参数
   * @returns 状态、头与文本
   */
  private async send(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; headers: Headers; text: string; cached?: unknown }> {
    const method = options.method ?? 'GET'
    const url = this.url(path, options.query)
    const useCache = (options.cache ?? true) && method === 'GET'
    const cacheKey = `GET ${url}`
    const entry = useCache ? this.cache.get(cacheKey) : undefined
    const now = Date.now()

    if (entry !== undefined && now - entry.storedAt < this.options.cacheTtlMs) {
      return {
        status: 200,
        headers: new Headers(),
        text: '',
        cached: entry.data,
      }
    }

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    const attempts = Math.max(0, this.options.retries) + 1
    let lastError: unknown

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), this.options.timeoutMs)
      const onAbort = () => controller.abort(options.signal?.reason)
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        const response = await fetchImpl(url, {
          method,
          headers: this.headers(options, entry?.etag),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
          redirect: 'error',
        })

        if (response.status === 304 && entry !== undefined) {
          entry.storedAt = Date.now()
          return { status: 200, headers: response.headers, text: '', cached: entry.data }
        }

        const text = await response.text()

        if (!response.ok) {
          // 5xx 与 429 之外不重试：重试只会浪费配额
          if (response.status >= 500 && attempt + 1 < attempts) {
            lastError = mapHttpError(response.status, text, response.headers, path, this.options.token)
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
            continue
          }
          throw mapHttpError(response.status, text, response.headers, path, this.options.token)
        }

        if (useCache) {
          const etag = response.headers.get('etag')
          if (etag !== null) {
            try {
              this.cache.set(cacheKey, { etag, data: JSON.parse(text) as unknown, storedAt: Date.now() })
            } catch {
              // 非 JSON 响应（例如 diff）不缓存
            }
          }
        }

        return { status: response.status, headers: response.headers, text }
      } catch (error) {
        if (error instanceof GitError) throw error
        if (options.signal?.aborted === true) {
          throw new GitError('command-failed', 'GitHub 请求已取消', { hint: '调用方取消了该操作' })
        }
        lastError = error
        const isTimeout = controller.signal.aborted
        if (attempt + 1 < attempts && !isTimeout) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
          continue
        }
        if (isTimeout) {
          throw new GitError('timeout', `GitHub 请求超时（${this.options.timeoutMs}ms）：${path}`, {
            hint: '网络较慢时可在配置里调大 timeoutMs',
          })
        }
        throw new GitError('network', `GitHub 请求失败：${path}`, {
          stderr: redact(String(lastError), this.options.token),
          hint: '检查网络/代理；GitHub Enterprise 需要把 baseUrl 指向自己的 API 根',
        })
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
    }

    throw new GitError('network', `GitHub 请求失败：${path}`, {
      stderr: redact(String(lastError), this.options.token),
    })
  }

  /**
   * 发一次 JSON 请求。
   *
   * @param path - 相对路径
   * @param options - 请求参数
   * @returns 解析后的 JSON
   */
  async json<T>(path: string, options: RequestOptions = {}): Promise<GitHubResponse<T>> {
    const result = await this.send(path, options)
    if (result.cached !== undefined) {
      return { data: result.cached as T, status: result.status, headers: result.headers }
    }
    try {
      return { data: JSON.parse(result.text) as T, status: result.status, headers: result.headers }
    } catch {
      throw new GitError('command-failed', `GitHub 返回了无法解析的 JSON：${path}`, {
        stderr: result.text.slice(0, 200),
      })
    }
  }

  /**
   * 发一次文本请求（diff 用）。
   *
   * @param path - 相对路径
   * @param options - 请求参数
   * @returns 原始文本
   */
  async text(path: string, options: RequestOptions = {}): Promise<GitHubResponse<string>> {
    const result = await this.send(path, { ...options, cache: false })
    return { data: result.cached === undefined ? result.text : String(result.cached), status: result.status, headers: result.headers }
  }

  /** 清空缓存（测试与长会话用）。 */
  clearCache(): void {
    this.cache.clear()
  }
}
