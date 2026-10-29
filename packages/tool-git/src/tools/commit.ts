/**
 * `git_commit`：提交（写操作，走审批）。
 *
 * 提交说明走 stdin（`-F -`），因此多行、引号、`$()` 都原样保留。
 *
 * @module dsh-git-tool-git/tools/commit
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { pathsParam, repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/**
 * 注册 `git_commit`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerCommitTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'write',
    '创建提交，会写入 git 历史并可能触发 hooks',
    defineTool({
      name: withPrefix(prefix, 'git_commit'),
      description:
        '创建一个提交。paths 省略时提交索引里已有的内容；给了 paths 会先 stage 这些路径再提交。message 支持多行。amend=true 会改写上一个提交。需要审批。',
      parameters: {
        repoDir: repoDirParam,
        message: { type: 'string', required: true, description: '提交说明，支持多行' },
        paths: pathsParam,
        amend: { type: 'boolean', description: '是否 amend 上一个提交（默认 false）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            sha: { type: 'string', required: true },
            shortSha: { type: 'string', required: true },
            summary: { type: 'string', required: true },
            filesChanged: { type: 'integer', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `已提交 ${value.shortSha}：${value.summary}（${value.filesChanged} 个文件）`,
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git commit ${args.amend === true ? '(amend) ' : ''}${args.message.split('\n')[0] ?? ''}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const result = await ctx.git.commit(repo, {
            message: args.message,
            ...(args.paths === undefined ? {} : { paths: args.paths }),
            ...(args.amend === undefined ? {} : { amend: args.amend }),
            signal: exec.signal,
          })
          return {
            root: repo.root,
            sha: result.sha,
            shortSha: result.shortSha,
            summary: result.summary,
            filesChanged: result.filesChanged,
            message: args.message,
          }
        } catch (error) {
          throw asToolError(error, 'git_commit')
        }
      },
    }),
  )
}
