/**
 * `git_stash`：stash 的 save / list / pop / drop（写操作，走审批）。
 *
 * @module dsh-git-tool-git/tools/stash
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StashAction } from 'dsh-git-core'
import { registerGitTool, withPrefix } from '../define.js'
import { repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/** 把扁平参数翻译成领域动作。 */
function actionFrom(args: {
  action: string
  message?: string
  index?: number
  includeUntracked?: boolean
}): StashAction {
  switch (args.action) {
    case 'list':
      return { action: 'list' }
    case 'save':
      return {
        action: 'save',
        ...(args.message === undefined ? {} : { message: args.message }),
        ...(args.includeUntracked === undefined ? {} : { includeUntracked: args.includeUntracked }),
      }
    case 'pop':
    case 'drop':
      return {
        action: args.action,
        ...(args.index === undefined ? {} : { index: args.index }),
      }
    default:
      throw new Error(`未知的 action：${args.action}（可用：list / save / pop / drop）`)
  }
}

/**
 * 注册 `git_stash`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerStashTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '暂存或恢复工作区变更，可能改动工作区文件',
    defineTool({
      name: withPrefix(prefix, 'git_stash'),
      description:
        'stash 操作：save（可带 message、includeUntracked）/ list / pop（恢复到工作区）/ drop（丢弃）。index 默认 0（最近一条）。需要审批。',
      parameters: {
        repoDir: repoDirParam,
        action: { type: 'string', required: true, enum: ['list', 'save', 'pop', 'drop'] },
        message: { type: 'string', description: 'save 时的说明' },
        index: { type: 'integer', description: 'pop/drop 的目标序号，默认 0' },
        includeUntracked: { type: 'boolean', description: 'save 时是否包含未跟踪文件' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            stashes: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'integer', required: true },
                  sha: { type: 'string', required: true },
                  message: { type: 'string', required: true },
                  branch: { type: 'string', required: true },
                },
              },
            },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.stashes.length === 0
                ? `${value.root}：没有 stash 记录`
                : [
                    `${value.root}：${value.stashes.length} 条 stash`,
                    ...value.stashes.map((entry) => `  stash@{${entry.index}} ${entry.message}`),
                    value.summary,
                  ].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git stash ${args.action}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const stashes = await ctx.git.stash(repo, actionFrom(args), { signal: exec.signal })
          return {
            root: repo.root,
            stashes: stashes.map((entry) => ({
              index: entry.index,
              sha: entry.sha,
              message: entry.message,
              branch: entry.branch,
            })),
            summary: `${args.action} 完成，当前有 ${stashes.length} 条 stash`,
          }
        } catch (error) {
          throw asToolError(error, 'git_stash')
        }
      },
    }),
  )
}
