/**
 * `git_stage`：把路径加入索引（写操作，走审批）。
 *
 * @module dsh-git-tool-git/tools/stage
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { fileChangesSchema, pathsParam, repoDirParam } from '../schema.js'
import { asToolError, renderGroup, resolveToolRepo, toFileChangeValue } from '../support.js'

/**
 * 注册 `git_stage`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerStageTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '把指定路径加入 git 索引，会改变下一次提交的内容',
    defineTool({
      name: withPrefix(prefix, 'git_stage'),
      description:
        '把指定路径加入索引（相当于 git add -A -- <paths>，同时处理删除与重命名）。需要审批。返回操作后的已暂存文件列表。',
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
            staged: { ...fileChangesSchema, required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [`${value.root}`, renderGroup('已暂存', value.staged), value.summary].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git stage (${args.paths.length} 个路径)`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          await ctx.git.stage(repo, args.paths, { signal: exec.signal })
          const status = await ctx.git.status(repo, { signal: exec.signal })
          return {
            root: repo.root,
            staged: status.staged.map(toFileChangeValue),
            summary: `已暂存 ${args.paths.length} 个路径，索引中现在有 ${status.staged.length} 个文件`,
          }
        } catch (error) {
          throw asToolError(error, 'git_stage')
        }
      },
    }),
  )
}
