/**
 * `git_unstage`：把路径移出索引（写操作，走审批）。
 *
 * @module dsh-git-tool-git/tools/unstage
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { fileChangesSchema, pathsParam, repoDirParam } from '../schema.js'
import { asToolError, renderGroup, resolveToolRepo, toFileChangeValue } from '../support.js'

/**
 * 注册 `git_unstage`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerUnstageTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '把指定路径移出 git 索引，工作区文件保持不变',
    defineTool({
      name: withPrefix(prefix, 'git_unstage'),
      description:
        '把指定路径移出索引（相当于 git reset HEAD -- <paths>），工作区内容不变。需要审批。返回操作后仍未暂存的文件列表。',
      parameters: {
        repoDir: repoDirParam,
        paths: { ...pathsParam, required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            unstaged: { ...fileChangesSchema, required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [`${value.root}`, renderGroup('未暂存', value.unstaged), value.summary].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git unstage (${args.paths.length} 个路径)`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          await ctx.git.unstage(repo, args.paths, { signal: exec.signal })
          const status = await ctx.git.status(repo, { signal: exec.signal })
          return {
            root: repo.root,
            unstaged: status.unstaged.map(toFileChangeValue),
            summary: `已取消暂存 ${args.paths.length} 个路径，索引中还剩 ${status.staged.length} 个文件`,
          }
        } catch (error) {
          throw asToolError(error, 'git_unstage')
        }
      },
    }),
  )
}
