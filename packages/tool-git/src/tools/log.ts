/**
 * `git_log`：只读，提交历史（可选提交图前缀）。
 *
 * @module dsh-git-tool-git/tools/log
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { commitSchema, pathsParam, repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/**
 * 注册 `git_log`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerLogTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取提交历史，不改变任何文件',
    defineTool({
      name: withPrefix(prefix, 'git_log'),
      description:
        '读取提交历史（新到旧）。limit 默认 20、上限 200；graph=true 时返回提交图前缀；paths 只看这些路径的历史；since 支持 "2 weeks ago" 这类 git 时间表达。只读。',
      parameters: {
        repoDir: repoDirParam,
        limit: { type: 'integer', description: '条数，默认 20，上限 200' },
        paths: pathsParam,
        graph: { type: 'boolean', description: '是否返回提交图前缀' },
        since: { type: 'string', description: '起始时间，例如 "2 weeks ago"' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            commits: { type: 'array', required: true, items: commitSchema },
            count: { type: 'integer', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => {
          if (value.commits.length === 0) {
            return [{ type: 'text', text: `${value.root}：没有匹配的提交` }]
          }
          const lines = value.commits.map((commit) => {
            const prefixText = commit.graph === undefined ? '' : `${commit.graph}`
            return `${prefixText}${commit.shortSha} ${commit.date.slice(0, 10)} ${commit.author}: ${commit.subject}`
          })
          return [
            {
              type: 'text',
              text: [`${value.root}：最近 ${value.count} 条提交`, ...lines].join('\n'),
            },
          ]
        },
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'git log',
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const commits = await ctx.git.log(repo, {
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(args.paths === undefined ? {} : { paths: args.paths }),
            ...(args.graph === undefined ? {} : { graph: args.graph }),
            ...(args.since === undefined ? {} : { since: args.since }),
            signal: exec.signal,
          })
          return {
            root: repo.root,
            commits: commits.map((commit) => ({
              sha: commit.sha,
              shortSha: commit.shortSha,
              author: commit.author,
              authorEmail: commit.authorEmail,
              date: commit.date,
              subject: commit.subject,
              parents: commit.parents,
              ...(commit.graph === undefined ? {} : { graph: commit.graph }),
            })),
            count: commits.length,
            summary:
              commits.length === 0
                ? '没有匹配的提交'
                : `最近 ${commits.length} 条提交，最新一条：${commits[0]?.shortSha ?? ''} ${commits[0]?.subject ?? ''}`,
          }
        } catch (error) {
          throw asToolError(error, 'git_log')
        }
      },
    }),
  )
}
