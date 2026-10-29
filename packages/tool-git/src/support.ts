/**
 * 工具层共用逻辑：定位仓库、把 {@link GitError} 翻成人话。
 *
 * @module dsh-git-tool-git/support
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
// 仅为了引入 dsh-working-directory 对 Context 的声明合并（ctx.workingDirectory）
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { isGitError, type FileChange, type RepoRef } from 'dsh-git-core'

/** `ctx.workingDirectory` 的类型来源；仅用于类型位置。 */
export type { WorkingDirectoryService }

/**
 * 解析本次调用要操作的仓库。
 *
 * 顺序：显式 `repoDir` → 会话工作目录（`ctx.workingDirectory`）→ 进程工作目录。
 *
 * @param ctx - 插件上下文
 * @param exec - 工具执行上下文（提供 agent 与取消信号）
 * @param repoDir - 模型显式给出的目录
 * @returns 已 realpath 的仓库引用
 */
export async function resolveToolRepo(
  ctx: Context,
  exec: ToolRunContext,
  repoDir?: string,
): Promise<RepoRef> {
  const cwd = repoDir ?? (await sessionDirectory(ctx, exec))
  return ctx.git.resolveRepo(cwd, { signal: exec.signal })
}

/**
 * 取会话当前工作目录。
 *
 * `ctx.workingDirectory` 是**可选**依赖：没有它（例如纯 CLI 冒烟、嵌入式调用）时
 * 退回进程工作目录，而不是让整个工具包 PENDING。
 *
 * @param ctx - 插件上下文
 * @param exec - 工具执行上下文
 * @returns 绝对目录
 */
export async function sessionDirectory(ctx: Context, exec: ToolRunContext): Promise<string> {
  const service = ctx.get('workingDirectory')
  if (service !== undefined && exec.agent !== undefined) {
    return service.ensure(exec.agent, exec.signal)
  }
  return process.cwd()
}

/**
 * 把任意错误翻成模型能直接照做的文本。
 *
 * @param error - 捕获值
 * @param toolName - 出错的工具名
 * @returns 带建议的错误
 */
export function asToolError(error: unknown, toolName: string): Error {
  if (isGitError(error)) {
    const hint = error.detail.hint === undefined ? '' : `\n建议：${error.detail.hint}`
    return new Error(`${toolName} 失败（${error.code}）：${error.message}${hint}`)
  }
  if (error instanceof Error) {
    return new Error(`${toolName} 失败：${error.message}`)
  }
  return new Error(`${toolName} 失败：${String(error)}`)
}

/** 状态字母 → 中文短语，用于给人看的摘要。 */
const STATUS_LABEL: Record<FileChange['status'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
  unmerged: '冲突',
  untracked: '未跟踪',
}

/** 渲染所需的最小变更形状：`FileChange` 与工具输出的规范值都满足它。 */
export interface ChangeLike {
  path: string
  oldPath?: string
  status: FileChange['status']
  additions?: number
  deletions?: number
  binary: boolean
}

/**
 * 单行描述一个变更，例如 `修改 src/a.ts (+3/-1)`。
 *
 * @param change - 变更
 * @returns 一行文本
 */
export function describeChange(change: ChangeLike): string {
  const stats =
    change.additions === undefined && change.deletions === undefined
      ? ''
      : ` (+${change.additions ?? 0}/-${change.deletions ?? 0})`
  const rename = change.oldPath === undefined ? '' : ` ← ${change.oldPath}`
  const binary = change.binary ? ' [二进制]' : ''
  return `${STATUS_LABEL[change.status]} ${change.path}${rename}${stats}${binary}`
}

/** 工具输出里的规范变更形状。 */
export interface FileChangeValue {
  path: string
  oldPath?: string
  status: FileChange['status']
  staged: boolean
  additions?: number
  deletions?: number
  binary: boolean
}

/**
 * 把变更渲染成可 JSON 序列化的规范值（丢掉 undefined 字段）。
 *
 * @param change - 变更
 * @returns 规范值
 */
export function toFileChangeValue(change: FileChange): FileChangeValue {
  return {
    path: change.path,
    ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
    status: change.status,
    staged: change.staged,
    ...(change.additions === undefined ? {} : { additions: change.additions }),
    ...(change.deletions === undefined ? {} : { deletions: change.deletions }),
    binary: change.binary,
  }
}

/**
 * 把变更列表渲染成多行文本；空列表给一句明确的话。
 *
 * @param title - 分组标题
 * @param changes - 变更
 * @returns 文本块内容
 */
export function renderGroup(title: string, changes: readonly ChangeLike[]): string {
  if (changes.length === 0) return `${title}：无`
  return [`${title}（${changes.length}）`, ...changes.map((change) => `  - ${describeChange(change)}`)].join(
    '\n',
  )
}
