/**
 * `git_branch`：分支的 list / create / switch / delete（写操作，走审批）。
 *
 * @module dsh-git-tool-git/tools/branch
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BranchAction } from 'dsh-git-core'
import { registerGitTool, withPrefix } from '../define.js'
import { nullableString, repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/** 把扁平参数翻译成领域动作。 */
function actionFrom(args: {
  action: string
  name?: string
  from?: string
  force?: boolean
}): BranchAction {
  switch (args.action) {
    case 'list':
      return { action: 'list' }
    case 'create':
      if (args.name === undefined || args.name.trim() === '') {
        throw new Error('action=create 时必须给 name')
      }
      return {
        action: 'create',
        name: args.name,
        ...(args.from === undefined ? {} : { from: args.from }),
      }
    case 'switch':
      if (args.name === undefined || args.name.trim() === '') {
        throw new Error('action=switch 时必须给 name')
      }
      return { action: 'switch', name: args.name }
    case 'delete':
      if (args.name === undefined || args.name.trim() === '') {
        throw new Error('action=delete 时必须给 name')
      }
      return {
        action: 'delete',
        name: args.name,
        ...(args.force === undefined ? {} : { force: args.force }),
      }
    default:
      throw new Error(`未知的 action：${args.action}（可用：list / create / switch / delete）`)
  }
}

/**
 * 注册 `git_branch`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerBranchTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '创建、切换或删除分支，会改变 HEAD 或 refs/heads',
    defineTool({
      name: withPrefix(prefix, 'git_branch'),
      description:
        '分支操作：list（只读）/ create（可指定 from 起点）/ switch（切换）/ delete（默认拒绝未合并分支，force=true 才强制）。需要审批。',
      parameters: {
        repoDir: repoDirParam,
        action: {
          type: 'string',
          required: true,
          enum: ['list', 'create', 'switch', 'delete'],
        },
        name: { type: 'string', description: '分支名（create/switch/delete 必填）' },
        from: { type: 'string', description: 'create 的起点引用' },
        force: { type: 'boolean', description: 'delete 时是否强制（默认 false）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            current: nullableString,
            branches: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  current: { type: 'boolean', required: true },
                  sha: { type: 'string', required: true },
                  upstream: nullableString,
                  ahead: { type: 'integer', required: true },
                  behind: { type: 'integer', required: true },
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
              `${value.root}（当前分支：${value.current ?? 'detached HEAD'}）`,
              ...value.branches.map(
                (branch) =>
                  `  ${branch.current ? '*' : ' '} ${branch.name}` +
                  (branch.upstream === null ? '' : ` → ${branch.upstream}（+${branch.ahead}/-${branch.behind}）`),
              ),
              value.summary,
            ].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git branch ${args.action}${args.name === undefined ? '' : ` ${args.name}`}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const branches = await ctx.git.branch(repo, actionFrom(args), { signal: exec.signal })
          const current = branches.find((branch) => branch.current)?.name ?? null
          return {
            root: repo.root,
            current,
            branches: branches.map((branch) => ({
              name: branch.name,
              current: branch.current,
              sha: branch.sha,
              upstream: branch.upstream,
              ahead: branch.ahead,
              behind: branch.behind,
            })),
            summary: `${branches.length} 个本地分支，当前在 ${current ?? 'detached HEAD'}`,
          }
        } catch (error) {
          throw asToolError(error, 'git_branch')
        }
      },
    }),
  )
}
