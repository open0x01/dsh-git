/**
 * `LocalGitHubService`：`ctx.github` 的 REST 实现。
 *
 * 关键约束（docs/08 ADR-003 / ADR-005 / ADR-009）：
 * - 只用 `fetch`，不引入 Octokit，不包装 `gh` CLI；
 * - 每次操作前用 `ctx.credentials.resolve(tokenRef)` 现取 token，不在配置/磁盘/日志里留明文；
 *   客户端实例会随 token 变化重建（旧实例的 ETag 缓存随之丢弃）；
 * - 401/403/429 映射为结构化错误，工具层再翻成人话；
 * - PR 列表不查 checks（省请求），详情页才查，失败也不阻塞主结果。
 *
 * @module dsh-git-github/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  GitError,
  GitHubService,
  isGitError,
  type AuthStatus,
  type CreatePullInput,
  type DiffResult,
  type IssueDetail,
  type IssueSummary,
  type ListOptions,
  type PullRequestDetail,
  type PullRequestSummary,
  type RepoRef,
  type RepoSlug,
  type RepoView,
} from 'dsh-git-core'
import { GitHubClient } from './client.js'
import type { Config } from './config.js'
import {
  mapFileChangeStatus,
  mapIssue,
  mapIssueDetail,
  mapPull,
  mapPullDetail,
  mapRepo,
  parseRemoteUrl,
  summarizeChecks,
  truncatePatch,
  type RawCheckRuns,
  type RawFile,
  type RawIssue,
  type RawPull,
  type RawRepo,
} from './map.js'

/** 构造选项（测试注入 fetch 与 token）。 */
export interface ServiceOptions {
  fetchImpl?: typeof globalThis.fetch
  /** 测试用：直接提供 token，跳过 ctx.credentials 解析 */
  tokenProvider?: () => Promise<string | undefined>
}

/**
 * GitHub 服务实现。
 */
export class LocalGitHubService extends GitHubService {
  private readonly config: Config
  private readonly fetchImpl: typeof globalThis.fetch | undefined
  private readonly tokenProvider: (() => Promise<string | undefined>) | undefined
  private cached: { token: string; client: GitHubClient } | null = null

  constructor(ctx: Context, config: Config, options: ServiceOptions = {}) {
    super(ctx)
    this.config = config
    this.fetchImpl = options.fetchImpl
    this.tokenProvider = options.tokenProvider
  }

  /**
   * 现取 token；缺失即抛 `auth-missing`（带可执行提示）。
   *
   * @returns token 明文（仅在内存中传递给客户端）
   */
  private async token(): Promise<string> {
    if (this.tokenProvider !== undefined) {
      const injected = await this.tokenProvider()
      if (injected === undefined || injected.trim() === '') {
        throw new GitError('auth-missing', '未配置凭据（测试注入）', { hint: '注入一个 token' })
      }
      return injected
    }
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new GitError('auth-missing', '缺少凭据服务（ctx.credentials）', {
        hint: '确认 profile 里加载了 @deepseek-ai/dsh-credentials',
      })
    }
    const resolved = await credentials.resolve(credentialRef(this.config.tokenRef))
    if (resolved === undefined || resolved.value.trim() === '') {
      throw new GitError('auth-missing', `未配置凭据 ${this.config.tokenRef}`, {
        hint: `设置环境变量 ${this.config.tokenRef}，或在 DSH 凭据里配置同名项（值不需要重启插件）`,
      })
    }
    return resolved.value
  }

  /** 按 token 复用客户端（ETag 缓存因此只在同一 token 内有效）。 */
  private async client(): Promise<GitHubClient> {
    const token = await this.token()
    if (this.cached !== null && this.cached.token === token) return this.cached.client
    const client = new GitHubClient({
      baseUrl: this.config.baseUrl,
      token,
      timeoutMs: this.config.timeoutMs,
      cacheTtlMs: this.config.cacheTtlMs,
      userAgent: this.config.userAgent,
      retries: this.config.retries,
      ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
    })
    this.cached = { token, client }
    return client
  }

  /** 仓库路径前缀。 */
  private repoPath(slug: RepoSlug): string {
    return `/repos/${slug.owner}/${slug.repo}`
  }

  override async resolveSlug(repo: RepoRef, signal?: AbortSignal): Promise<RepoSlug> {
    const git = this.ctx.get('git')
    if (git === undefined) {
      throw new GitError('unsupported', '缺少 ctx.git，无法从 remote 推导 owner/repo', {
        hint: '显式传入 owner 与 repo',
      })
    }
    const remotes = await git.remotes(repo, signal === undefined ? {} : { signal })
    if (remotes.length === 0) {
      throw new GitError('invalid-ref', `${repo.root} 没有配置任何 git remote`, {
        hint: '先 git remote add origin <url>，或显式传入 owner 与 repo',
      })
    }
    const remote = remotes.find((entry) => entry.name === this.config.defaultRemote) ?? remotes[0]
    const slug = parseRemoteUrl(remote?.url ?? '')
    if (slug === null) {
      throw new GitError('invalid-ref', `无法从 remote URL 推导 owner/repo：${remote?.url ?? ''}`, {
        hint: '显式传入 owner 与 repo',
      })
    }
    return slug
  }

  override async authStatus(signal?: AbortSignal): Promise<AuthStatus> {
    try {
      const client = await this.client()
      const response = await client.json<{ login?: string }>('/user', {
        cache: false,
        ...(signal === undefined ? {} : { signal }),
      })
      const scopes = (response.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '')
      return {
        configured: true,
        scopes,
        ...(response.data.login === undefined ? {} : { login: response.data.login }),
      }
    } catch (error) {
      if (isGitError(error) && error.code === 'auth-missing') {
        return {
          configured: false,
          scopes: [],
          hint: `${error.message}${error.detail.hint === undefined ? '' : `（${error.detail.hint}）`}`,
        }
      }
      throw error
    }
  }

  override async repoView(slug: RepoSlug, signal?: AbortSignal): Promise<RepoView> {
    const client = await this.client()
    const response = await client.json<RawRepo>(this.repoPath(slug), {
      ...(signal === undefined ? {} : { signal }),
    })
    return mapRepo(response.data)
  }

  override async listPulls(slug: RepoSlug, options: ListOptions = {}): Promise<PullRequestSummary[]> {
    const client = await this.client()
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100)
    const response = await client.json<RawPull[]>(`${this.repoPath(slug)}/pulls`, {
      query: {
        state: options.state ?? 'open',
        per_page: limit,
        sort: 'updated',
        direction: 'desc',
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return (response.data ?? []).slice(0, limit).map((raw) => mapPull(raw))
  }

  override async getPull(
    slug: RepoSlug,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestDetail> {
    const client = await this.client()
    const signalOption = signal === undefined ? {} : { signal }
    const pull = await client.json<RawPull>(`${this.repoPath(slug)}/pulls/${number}`, signalOption)
    const files = await client.json<RawFile[]>(`${this.repoPath(slug)}/pulls/${number}/files`, {
      query: { per_page: this.config.maxFiles },
      ...signalOption,
    })
    const checks = await this.checksFor(client, slug, pull.data.head?.sha, signal)
    const filesData = (files.data ?? []).slice(0, this.config.maxFiles)
    return checks === undefined
      ? mapPullDetail(pull.data, filesData)
      : mapPullDetail(pull.data, filesData, checks)
  }

  /** 尽力取 check-runs；无权限或没有 sha 时返回 undefined，不影响主结果。 */
  private async checksFor(
    client: GitHubClient,
    slug: RepoSlug,
    sha: string | undefined,
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof summarizeChecks> | undefined> {
    if (sha === undefined || sha === '') return undefined
    try {
      const response = await client.json<RawCheckRuns>(
        `${this.repoPath(slug)}/commits/${sha}/check-runs`,
        { query: { per_page: 100 }, ...(signal === undefined ? {} : { signal }) },
      )
      return summarizeChecks(response.data)
    } catch {
      return undefined
    }
  }

  override async pullDiff(
    slug: RepoSlug,
    number: number,
    signal?: AbortSignal,
  ): Promise<DiffResult> {
    const client = await this.client()
    const signalOption = signal === undefined ? {} : { signal }
    const patch = await client.text(`${this.repoPath(slug)}/pulls/${number}`, {
      accept: 'application/vnd.github.v3.diff',
      ...signalOption,
    })
    const files = await client.json<RawFile[]>(`${this.repoPath(slug)}/pulls/${number}/files`, {
      query: { per_page: this.config.maxFiles },
      ...signalOption,
    })
    const truncated = truncatePatch(patch.data, this.config.maxDiffBytes)
    return {
      files: (files.data ?? []).slice(0, this.config.maxFiles).map((raw) => ({
        path: raw.filename,
        status: mapFileChangeStatus(raw.status),
        staged: false,
        additions: raw.additions ?? 0,
        deletions: raw.deletions ?? 0,
        binary: false,
      })),
      patch: truncated.patch,
      truncated: truncated.truncated,
    }
  }

  override async createPull(
    slug: RepoSlug,
    input: CreatePullInput,
  ): Promise<PullRequestSummary> {
    const client = await this.client()
    const response = await client.json<RawPull>(`${this.repoPath(slug)}/pulls`, {
      method: 'POST',
      body: {
        title: input.title,
        head: input.head,
        base: input.base,
        ...(input.body === undefined ? {} : { body: input.body }),
        draft: input.draft ?? true,
      },
      cache: false,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return mapPull(response.data)
  }

  override async listIssues(slug: RepoSlug, options: ListOptions = {}): Promise<IssueSummary[]> {
    const client = await this.client()
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100)
    const response = await client.json<RawIssue[]>(`${this.repoPath(slug)}/issues`, {
      query: {
        state: options.state ?? 'open',
        per_page: limit,
        sort: 'updated',
        direction: 'desc',
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return (response.data ?? [])
      .filter((raw) => raw.pull_request === undefined)
      .slice(0, limit)
      .map(mapIssue)
  }

  override async getIssue(slug: RepoSlug, number: number, signal?: AbortSignal): Promise<IssueDetail> {
    const client = await this.client()
    const response = await client.json<RawIssue>(`${this.repoPath(slug)}/issues/${number}`, {
      ...(signal === undefined ? {} : { signal }),
    })
    return mapIssueDetail(response.data)
  }
}
