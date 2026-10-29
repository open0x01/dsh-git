/**
 * `ctx.github` 服务定义：GitHub 平台操作的唯一入口。
 *
 * v0.1 只支持 PAT（`CredentialRef`），不包装 `gh` CLI，不实现 OAuth device flow。
 *
 * @module dsh-git-core/github
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { DiffResult, RepoRef } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    github: GitHubService
  }
}

/** `owner/repo` 二元组。 */
export interface RepoSlug {
  owner: string
  repo: string
}

/** CI 检查汇总。 */
export interface CheckSummary {
  total: number
  passed: number
  failed: number
  pending: number
}

/** PR 列表项。 */
export interface PullRequestSummary {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  author: string
  head: string
  base: string
  url: string
  updatedAt: string
  checks: CheckSummary
}

/** PR 详情。 */
export interface PullRequestDetail extends PullRequestSummary {
  body: string
  mergeable: boolean | null
  additions: number
  deletions: number
  changedFiles: number
  files: PullRequestFile[]
  commits: number
  labels: string[]
}

/** PR 中的单个文件。 */
export interface PullRequestFile {
  path: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  changes: number
}

/** Issue 列表项。 */
export interface IssueSummary {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  url: string
  updatedAt: string
  labels: string[]
  comments: number
}

/** Issue 详情。 */
export interface IssueDetail extends IssueSummary {
  body: string
}

/** 仓库概览。 */
export interface RepoView {
  owner: string
  repo: string
  defaultBranch: string
  visibility: 'public' | 'private' | 'internal'
  archived: boolean
  url: string
  /** 当前 token 对该仓库的权限，例如 `{ push: true, admin: false }` */
  permissions: Record<string, boolean>
}

/** 认证状态；绝不包含 token 本身。 */
export interface AuthStatus {
  configured: boolean
  /** token 缺失时的可执行修复提示 */
  hint?: string
  login?: string
  scopes: string[]
}

/** 列表查询参数。 */
export interface ListOptions {
  state?: 'open' | 'closed' | 'all'
  limit?: number
  signal?: AbortSignal
}

/** 新建 PR 的输入。 */
export interface CreatePullInput {
  title: string
  head: string
  base: string
  body?: string
  /** 默认 true：v0.1 只建 draft PR */
  draft?: boolean
  signal?: AbortSignal
}

/**
 * GitHub 服务。
 *
 * 契约约束：
 * - 每次调用前由 Provider 通过 `ctx.credentials` 解析 token；插件内不缓存明文。
 * - 只访问 `api.github.com` 或配置的 `baseUrl`（GHE），不跟随重定向到其他 host。
 * - 失败一律抛 `GitError`，401/403/429 映射为 `auth-missing` / `rate-limited`。
 */
export abstract class GitHubService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'github')
  }

  /** 从 `git remote` 推导 owner/repo；推导失败时要求显式传入。 */
  abstract resolveSlug(repo: RepoRef, signal?: AbortSignal): Promise<RepoSlug>

  /** 认证状态。 */
  abstract authStatus(signal?: AbortSignal): Promise<AuthStatus>

  /** 仓库概览。 */
  abstract repoView(slug: RepoSlug, signal?: AbortSignal): Promise<RepoView>

  /** PR 列表。 */
  abstract listPulls(slug: RepoSlug, options?: ListOptions): Promise<PullRequestSummary[]>

  /** PR 详情。 */
  abstract getPull(slug: RepoSlug, number: number, signal?: AbortSignal): Promise<PullRequestDetail>

  /** PR 的 unified diff。 */
  abstract pullDiff(slug: RepoSlug, number: number, signal?: AbortSignal): Promise<DiffResult>

  /** 新建 PR（默认 draft）。 */
  abstract createPull(slug: RepoSlug, input: CreatePullInput): Promise<PullRequestSummary>

  /** Issue 列表。 */
  abstract listIssues(slug: RepoSlug, options?: ListOptions): Promise<IssueSummary[]>

  /** Issue 详情。 */
  abstract getIssue(slug: RepoSlug, number: number, signal?: AbortSignal): Promise<IssueDetail>
}
