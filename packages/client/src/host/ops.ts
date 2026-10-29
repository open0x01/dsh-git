/**
 * 面板 RPC 的「操作」层：与 HTTP 无关，便于单测与复用。
 *
 * 设计取舍（docs/04 T4.1 / T4.7）：
 * - 只暴露**白名单**里的 op，未知 op 一律 400，不做「透传任意 git 命令」；
 * - 读操作直接复用 `ctx.git` / `ctx.github`，与模型工具同一套校验；
 * - **写操作在 v0.1 返回 501**：审批需要 agent 与进行中的 turn，而 HTTP 路由没有
 *   agent 上下文，绕过审批就成了「没有闸门的后门」。写操作请走模型工具（`git_commit` 等），
 *   它们会经过 `dsh-git-policy`。等宿主提供「按 session 绑定的审批入口」再开放。
 *
 * @module dsh-git-client/host/ops
 */

import type { Context } from '@deepseek-ai/cordis'
import { GitError, type RepoRef } from 'dsh-git-core'

/** 允许的 op。 */
export const READ_OPS = ['snapshot', 'branches', 'worktrees', 'pr'] as const

/** 尚未开放的写 op（显式列出，便于给出可执行的报错）。 */
export const WRITE_OPS = ['stage', 'unstage', 'commit', 'switch', 'stash'] as const

/** 所有已知 op。 */
export type OpName = (typeof READ_OPS)[number] | (typeof WRITE_OPS)[number]

/** 一次 RPC 的输入。 */
export interface OpRequest {
  /** 仓库目录；省略时用进程工作目录 */
  repoDir?: string
  /** `pr` op 用：owner */
  owner?: string
  /** `pr` op 用：repo */
  repo?: string
  /** `pr` op 用：state */
  state?: 'open' | 'closed' | 'all'
  /** `pr` op 用：条数 */
  limit?: number
}

/** 带 HTTP 语义的错误。 */
export class RpcError extends Error {
  readonly status: number
  readonly code: string
  readonly hint?: string

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message)
    this.name = 'RpcError'
    this.status = status
    this.code = code
    if (hint !== undefined) this.hint = hint
  }
}

/**
 * 判断一个字符串是否是已知 op。
 *
 * @param value - 候选值
 * @returns 是否已知
 */
export function isOpName(value: string): value is OpName {
  return (READ_OPS as readonly string[]).includes(value) || (WRITE_OPS as readonly string[]).includes(value)
}

/** 把 op 请求里的仓库目录解析成仓库引用。 */
async function repoFor(ctx: Context, request: OpRequest): Promise<RepoRef> {
  return ctx.git.resolveRepo(request.repoDir ?? process.cwd())
}

/**
 * 执行一个 op。
 *
 * @param ctx - 插件上下文
 * @param op - op 名（调用前应已用 {@link isOpName} 校验）
 * @param request - 参数
 * @param maxCommits - `snapshot` 里返回的历史条数上限
 * @returns 可直接 JSON 序列化的数据
 * @throws RpcError 404/501 等；GitError 由调用方映射
 */
export async function runOp(
  ctx: Context,
  op: OpName,
  request: OpRequest,
  maxCommits: number,
): Promise<unknown> {
  if ((WRITE_OPS as readonly string[]).includes(op)) {
    throw new RpcError(
      501,
      'write-not-available',
      `面板暂不支持写操作：${op}`,
      '写操作需要通过模型工具执行（git_stage / git_commit 等），它们会走审批；面板 v0.1 只做只读展示',
    )
  }

  const repo = await repoFor(ctx, request)

  switch (op) {
    case 'snapshot': {
      const status = await ctx.git.status(repo)
      const commits = await ctx.git.log(repo, { limit: Math.min(maxCommits, 50) })
      return {
        repo: { root: repo.root, branch: repo.branch, operation: repo.operation, head: repo.head },
        status: {
          staged: status.staged,
          unstaged: status.unstaged,
          untracked: status.untracked,
          ahead: status.ahead,
          behind: status.behind,
          upstream: status.upstream,
        },
        commits: commits.map((commit) => ({
          sha: commit.sha,
          shortSha: commit.shortSha,
          author: commit.author,
          date: commit.date,
          subject: commit.subject,
        })),
      }
    }
    case 'branches': {
      const branches = await ctx.git.branch(repo, { action: 'list' })
      return { branches }
    }
    case 'worktrees': {
      const worktrees = await ctx.git.worktree(repo, { action: 'list' })
      return { worktrees }
    }
    case 'pr': {
      const github = ctx.get('github')
      if (github === undefined) {
        throw new RpcError(503, 'github-unavailable', 'ctx.github 未加载', '启用 dsh-git-github 行')
      }
      const slug =
        request.owner !== undefined && request.repo !== undefined
          ? { owner: request.owner, repo: request.repo }
          : await github.resolveSlug(repo)
      const pulls = await github.listPulls(slug, {
        state: request.state ?? 'open',
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      })
      return { owner: slug.owner, repo: slug.repo, pulls }
    }
  }
}

/**
 * 把领域错误映射成 HTTP 状态与错误体。
 *
 * @param error - 捕获值
 * @returns 状态码与错误体
 */
export function toErrorResponse(error: unknown): { status: number; body: { ok: false; error: { code: string; message: string; hint?: string } } } {
  if (error instanceof RpcError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.hint === undefined ? {} : { hint: error.hint }),
        },
      },
    }
  }
  if (error instanceof GitError) {
    const status = error.code === 'not-a-repo' || error.code === 'path-outside-repo' ? 400 : 502
    return {
      status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.detail.hint === undefined ? {} : { hint: error.detail.hint }),
        },
      },
    }
  }
  return {
    status: 500,
    body: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } },
  }
}
