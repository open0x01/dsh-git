/**
 * `git_show`：只读，单个提交的元数据 + patch。
 *
 * @module dsh-git-tool-git/tools/show
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { fileChangesSchema, repoDirParam } from '../schema.js'
import { asToolError, describeChange, resolveToolRepo, toFileChangeValue } from '../support.js'

/**
 * 注册 `git_show`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerShowTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取单个提交，不改变任何文件',
    defineTool({
      name: withPrefix(prefix, 'git_show'),
      description:
        '查看单个提交：作者、时间、说明、变更文件清单与 unified patch。sha 可以是完整 sha、短 sha 或分支/tag 名。只读。',
      parameters: {
        repoDir: repoDirParam,
        sha: { type: 'string', required: true, description: '提交 sha 或引用名' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            sha: { type: 'string', required: true },
            shortSha: { type: 'string', required: true },
            author: { type: 'string', required: true },
            date: { type: 'string', required: true },
            subject: { type: 'string', required: true },
            files: { ...fileChangesSchema, required: true },
            patch: { type: 'string', required: true },
            truncated: { type: 'boolean', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => {
          const head = [
            `${value.shortSha} ${value.author} ${value.date}`,
            value.subject,
            '',
            `变更 ${value.files.length} 个文件` + (value.truncated ? '（patch 已截断）' : ''),
            ...value.files.map((file) => `  - ${describeChange(file)}`),
          ]
          const body = value.patch === '' ? [] : ['', '```diff', value.patch, '```']
          return [{ type: 'text', text: [...head, ...body].join('\n') }]
        },
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git show ${args.sha}`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const result = await ctx.git.show(repo, args.sha, { signal: exec.signal })
          return {
            root: repo.root,
            sha: result.commit.sha,
            shortSha: result.commit.shortSha,
            author: result.commit.author,
            date: result.commit.date,
            subject: result.commit.subject,
            files: result.diff.files.map(toFileChangeValue),
            patch: result.diff.patch,
            truncated: result.diff.truncated,
            summary: `${result.commit.shortSha} ${result.commit.subject}（${result.diff.files.length} 个文件）`,
          }
        } catch (error) {
          throw asToolError(error, 'git_show')
        }
      },
    }),
  )
}
