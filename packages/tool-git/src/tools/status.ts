/**
 * `git_status`：只读，回答「现在改了什么」。
 *
 * @module dsh-git-tool-git/tools/status
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import {
  fileChangesSchema,
  nullableString,
  pathsParam,
  repoDirParam,
} from '../schema.js'
import { asToolError, renderGroup, resolveToolRepo, toFileChangeValue } from '../support.js'

/**
 * 注册 `git_status`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerStatusTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取工作区状态，不改变任何文件',
    defineTool({
      name: withPrefix(prefix, 'git_status'),
      description:
        '查看仓库状态：当前分支、与上游的领先/落后提交数、已暂存 / 未暂存 / 未跟踪三组文件。只读，不改变任何内容。回答「现在改了什么」时先用它。',
      parameters: {
        repoDir: repoDirParam,
        paths: pathsParam,
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true, description: '仓库根目录' },
            branch: nullableString,
            operation: nullableString,
            upstream: nullableString,
            ahead: { type: 'integer', required: true },
            behind: { type: 'integer', required: true },
            staged: { ...fileChangesSchema, required: true },
            unstaged: { ...fileChangesSchema, required: true },
            untracked: { ...fileChangesSchema, required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `${value.root}${value.branch === null ? '（detached HEAD）' : ` @ ${value.branch}`}` +
                (value.upstream === null ? '' : ` → ${value.upstream}（+${value.ahead}/-${value.behind}）`) +
                (value.operation === null ? '' : ` · 进行中的操作：${value.operation}`),
              renderGroup('已暂存', value.staged),
              renderGroup('未暂存', value.unstaged),
              renderGroup('未跟踪', value.untracked),
            ].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'git status',
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const status = await ctx.git.status(repo, {
            ...(args.paths === undefined ? {} : { paths: args.paths }),
            signal: exec.signal,
          })
          const total = status.staged.length + status.unstaged.length + status.untracked.length
          const summary =
            total === 0
              ? '工作区干净'
              : `${total} 个变更：已暂存 ${status.staged.length}、未暂存 ${status.unstaged.length}、未跟踪 ${status.untracked.length}`
          return {
            root: repo.root,
            branch: repo.branch,
            operation: repo.operation,
            upstream: status.upstream,
            ahead: status.ahead,
            behind: status.behind,
            staged: status.staged.map(toFileChangeValue),
            unstaged: status.unstaged.map(toFileChangeValue),
            untracked: status.untracked.map(toFileChangeValue),
            summary,
          }
        } catch (error) {
          throw asToolError(error, 'git_status')
        }
      },
    }),
  )
}
