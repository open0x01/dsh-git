/**
 * `git_worktree`：worktree 的 list / create / remove（写操作，走审批）。
 *
 * create 只能落在 `worktreeRoot` 下；remove 在主工作树、当前工作树、锁定、
 * 有未提交变更时一律硬拒绝，不提供 force（docs/08 ADR-010）。
 *
 * @module dsh-git-tool-git/tools/worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorktreeAction } from 'dsh-git-core'
import { registerGitTool, withPrefix } from '../define.js'
import { nullableString, repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/** 把扁平参数翻译成领域动作。 */
function actionFrom(args: {
  action: string
  path?: string
  branch?: string
  createBranch?: boolean
}): WorktreeAction {
  switch (args.action) {
    case 'list':
      return { action: 'list' }
    case 'create':
      return {
        action: 'create',
        ...(args.path === undefined ? {} : { path: args.path }),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(args.createBranch === undefined ? {} : { createBranch: args.createBranch }),
      }
    case 'remove':
      if (args.path === undefined || args.path.trim() === '') {
        throw new Error('action=remove 时必须给 path')
      }
      return { action: 'remove', path: args.path }
    default:
      throw new Error(`未知的 action：${args.action}（可用：list / create / remove）`)
  }
}

/**
 * 注册 `git_worktree`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerWorktreeTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '创建或删除工作树，会在磁盘上新增/删除目录',
    defineTool({
      name: withPrefix(prefix, 'git_worktree'),
      description:
        '工作树操作：list / create（默认建新分支，落点固定在 worktreeRoot 下）/ remove（主工作树、当前工作树、锁定、脏工作树一律拒绝，没有 force）。需要审批。',
      parameters: {
        repoDir: repoDirParam,
        action: { type: 'string', required: true, enum: ['list', 'create', 'remove'] },
        path: { type: 'string', description: 'create 的目录名（相对 worktreeRoot）/ remove 的绝对路径' },
        branch: { type: 'string', description: 'create 时的分支名' },
        createBranch: { type: 'boolean', description: 'create 时是否新建分支（默认 true）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            worktrees: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  head: { type: 'string', required: true },
                  branch: nullableString,
                  bare: { type: 'boolean', required: true },
                  detached: { type: 'boolean', required: true },
                  locked: { type: 'boolean', required: true },
                  main: { type: 'boolean', required: true },
                },
              },
            },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `${value.root}：${value.worktrees.length} 个工作树`,
              ...value.worktrees.map(
                (worktree) =>
                  `  ${worktree.main ? '[主]' : '    '} ${worktree.path}` +
                  (worktree.branch === null ? '（detached）' : ` @ ${worktree.branch}`) +
                  (worktree.locked ? '（locked）' : ''),
              ),
              value.summary,
            ].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git worktree ${args.action}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const worktrees = await ctx.git.worktree(repo, actionFrom(args), { signal: exec.signal })
          return {
            root: repo.root,
            worktrees: worktrees.map((worktree) => ({
              path: worktree.path,
              head: worktree.head,
              branch: worktree.branch,
              bare: worktree.bare,
              detached: worktree.detached,
              locked: worktree.locked,
              main: worktree.main,
            })),
            summary: `${args.action} 完成，当前有 ${worktrees.length} 个工作树`,
          }
        } catch (error) {
          throw asToolError(error, 'git_worktree')
        }
      },
    }),
  )
}
