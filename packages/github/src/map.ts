/**
 * 纯映射函数：GitHub 的原始 JSON → 领域类型。
 *
 * 单独一层的原因：这些函数没有 I/O，可以脱离 fetch 与 cordis 单测；
 * 也把「GitHub 字段改名」这类变动的影响面收敛到一个文件。
 *
 * @module dsh-git-github/map
 */

import type {
  CheckSummary,
  FileChange,
  IssueDetail,
  IssueSummary,
  PullRequestDetail,
  PullRequestFile,
  PullRequestSummary,
  RepoSlug,
  RepoView,
} from 'dsh-git-core'

/** `/pulls` 与 `/pulls/{n}` 的原始结构（只声明用到的字段）。 */
export interface RawPull {
  number: number
  title: string
  state: 'open' | 'closed'
  draft?: boolean | null
  merged_at?: string | null
  user?: { login?: string } | null
  head?: { ref?: string; sha?: string } | null
  base?: { ref?: string } | null
  html_url?: string
  updated_at?: string
  body?: string | null
  mergeable?: boolean | null
  additions?: number
  deletions?: number
  changed_files?: number
  commits?: number
  labels?: Array<{ name?: string }> | null
}

/** `/issues` 的原始结构。 */
export interface RawIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  user?: { login?: string } | null
  html_url?: string
  updated_at?: string
  labels?: Array<{ name?: string }> | null
  comments?: number
  body?: string | null
  pull_request?: unknown
}

/** `/repos/{o}/{r}` 的原始结构。 */
export interface RawRepo {
  name: string
  full_name?: string
  owner?: { login?: string } | null
  default_branch?: string
  private?: boolean
  visibility?: 'public' | 'private' | 'internal'
  archived?: boolean
  html_url?: string
  permissions?: Record<string, boolean>
}

/** `/pulls/{n}/files` 的元素。 */
export interface RawFile {
  filename: string
  status: string
  additions?: number
  deletions?: number
  changes?: number
  previous_filename?: string
}

/** `/commits/{sha}/check-runs` 的响应。 */
export interface RawCheckRuns {
  total_count: number
  check_runs: Array<{ status?: string; conclusion?: string | null }>
}

/** 把 label 数组拍平成字符串数组。 */
function labels(raw: Array<{ name?: string }> | null | undefined): string[] {
  return (raw ?? []).map((label) => label.name ?? '').filter((name) => name !== '')
}

/**
 * 映射 PR 摘要。
 *
 * @param raw - 原始结构
 * @param checks - 可选的检查汇总
 * @returns 领域摘要
 */
export function mapPull(raw: RawPull, checks?: CheckSummary): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.merged_at != null ? 'merged' : raw.state,
    draft: raw.draft === true,
    author: raw.user?.login ?? '',
    head: raw.head?.ref ?? '',
    base: raw.base?.ref ?? '',
    url: raw.html_url ?? '',
    updatedAt: raw.updated_at ?? '',
    ...(checks === undefined ? {} : { checks }),
  }
}

/**
 * 映射 PR 文件。
 *
 * @param raw - 原始结构
 * @returns 文件摘要
 */
export function mapFile(raw: RawFile): PullRequestFile {
  const status =
    raw.status === 'added' || raw.status === 'removed' || raw.status === 'renamed'
      ? raw.status
      : 'modified'
  return {
    path: raw.filename,
    status,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changes: raw.changes ?? (raw.additions ?? 0) + (raw.deletions ?? 0),
  }
}

/**
 * 映射 PR 详情。
 *
 * @param raw - 原始结构
 * @param files - 文件列表
 * @param checks - 可选的检查汇总
 * @returns 领域详情
 */
export function mapPullDetail(
  raw: RawPull,
  files: RawFile[],
  checks?: CheckSummary,
): PullRequestDetail {
  const summary = mapPull(raw, checks)
  return {
    ...summary,
    body: raw.body ?? '',
    mergeable: raw.mergeable ?? null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? files.length,
    files: files.map(mapFile),
    commits: raw.commits ?? 0,
    labels: labels(raw.labels),
  }
}

/**
 * 映射 Issue 摘要。
 *
 * @param raw - 原始结构
 * @returns 领域摘要
 */
export function mapIssue(raw: RawIssue): IssueSummary {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    author: raw.user?.login ?? '',
    url: raw.html_url ?? '',
    updatedAt: raw.updated_at ?? '',
    labels: labels(raw.labels),
    comments: raw.comments ?? 0,
  }
}

/**
 * 映射 Issue 详情。
 *
 * @param raw - 原始结构
 * @returns 领域详情
 */
export function mapIssueDetail(raw: RawIssue): IssueDetail {
  return { ...mapIssue(raw), body: raw.body ?? '' }
}

/**
 * 映射仓库概览。
 *
 * @param raw - 原始结构
 * @returns 领域概览
 */
export function mapRepo(raw: RawRepo): RepoView {
  const [ownerFromFullName = ''] = (raw.full_name ?? '').split('/')
  return {
    owner: raw.owner?.login ?? ownerFromFullName,
    repo: raw.name,
    defaultBranch: raw.default_branch ?? 'main',
    visibility: raw.visibility ?? (raw.private === true ? 'private' : 'public'),
    archived: raw.archived === true,
    url: raw.html_url ?? '',
    permissions: raw.permissions ?? {},
  }
}

/**
 * 汇总 check-runs。
 *
 * @param raw - 原始结构
 * @returns 通过/失败/进行中三类计数
 */
export function summarizeChecks(raw: RawCheckRuns): CheckSummary {
  let passed = 0
  let failed = 0
  let pending = 0
  for (const run of raw.check_runs ?? []) {
    if (run.status !== 'completed') {
      pending += 1
      continue
    }
    if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') {
      passed += 1
      continue
    }
    failed += 1
  }
  return { total: raw.total_count ?? passed + failed + pending, passed, failed, pending }
}

/**
 * 从 git remote URL 推导 owner/repo。
 *
 * 支持 https、ssh（`git@host:owner/repo.git`）、`ssh://`、`git://`，
 * 也接受 GitHub Enterprise 的任意 host。
 *
 * @param url - remote URL
 * @returns owner/repo；无法识别时返回 null
 */
export function parseRemoteUrl(url: string): RepoSlug | null {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed === '') return null

  const sshStyle = /^[\w.-]+@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(trimmed)
  if (sshStyle) {
    const [, , owner = '', repo = ''] = sshStyle
    return { owner, repo }
  }

  const urlStyle = /^(?:https?|ssh|git):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(
    trimmed,
  )
  if (urlStyle) {
    const [, , owner = '', repo = ''] = urlStyle
    return { owner, repo }
  }

  return null
}

/**
 * GitHub 的文件状态 → 领域 `FileChange` 状态。
 *
 * GitHub 用 `removed`，我们的领域类型用 `deleted`；这一层负责翻译。
 *
 * @param status - GitHub 的 status 字段
 * @returns 领域状态
 */
export function mapFileChangeStatus(status: string): FileChange['status'] {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'changed':
    case 'modified':
      return 'modified'
    default:
      return 'modified'
  }
}

/**
 * 把 GitHub 的 diff 文本按上限截断。
 *
 * @param patch - 原始 diff
 * @param maxBytes - 上限（字节）
 * @returns 截断后的文本与是否截断
 */
export function truncatePatch(patch: string, maxBytes: number): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { patch, truncated: false }
  return { patch: Buffer.from(patch, 'utf8').subarray(0, maxBytes).toString('utf8'), truncated: true }
}
