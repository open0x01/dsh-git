/**
 * `git_blame`：只读，逐行归属。
 *
 * @module dsh-git-tool-git/tools/blame
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { repoDirParam } from '../schema.js'
import { asToolError, resolveToolRepo } from '../support.js'

/**
 * 注册 `git_blame`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerBlameTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取逐行归属，不改变任何文件',
    defineTool({
      name: withPrefix(prefix, 'git_blame'),
      description:
        '逐行查看某个文件的归属（谁、什么时候、哪次提交改的）。大文件请用 startLine / endLine 限定范围。只读；未跟踪文件无法 blame。',
      parameters: {
        repoDir: repoDirParam,
        path: { type: 'string', required: true, description: '仓库内的文件路径' },
        startLine: { type: 'integer', description: '起始行（1 起，含）' },
        endLine: { type: 'integer', description: '结束行（含）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            path: { type: 'string', required: true },
            lines: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  line: { type: 'integer', required: true },
                  sha: { type: 'string', required: true },
                  shortSha: { type: 'string', required: true },
                  author: { type: 'string', required: true },
                  date: { type: 'string', required: true },
                  content: { type: 'string', required: true },
                },
              },
            },
            count: { type: 'integer', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `${value.path}：${value.count} 行`,
              ...value.lines.map(
                (line) =>
                  `${String(line.line).padStart(5, ' ')} ${line.shortSha} ${line.author.padEnd(12, ' ')} ${line.content}`,
              ),
            ].join('\n'),
          },
        ],
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git blame ${args.path}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const start = args.startLine
          const end = args.endLine
          const range =
            start === undefined && end === undefined
              ? undefined
              : { start: start ?? 1, end: end ?? start ?? 1 }
          const lines = await ctx.git.blame(
            repo,
            args.path,
            range,
            { signal: exec.signal },
          )
          return {
            root: repo.root,
            path: args.path,
            lines: lines.map((line) => ({
              line: line.line,
              sha: line.sha,
              shortSha: line.shortSha,
              author: line.author,
              date: line.date,
              content: line.content,
            })),
            count: lines.length,
            summary:
              lines.length === 0
                ? `${args.path}：没有可 blame 的行`
                : `${args.path}：${lines.length} 行，涉及 ${new Set(lines.map((line) => line.sha)).size} 次提交`,
          }
        } catch (error) {
          throw asToolError(error, 'git_blame')
        }
      },
    }),
  )
}
