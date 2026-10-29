/**
 * Issue 相关工具：`gh_issue_list` / `gh_issue_view`（只读）。
 *
 * @module dsh-git-tool-github/tools/issues
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { asToolError, resolveSlug, slugParams } from '../support.js'

/** Issue 列表项 schema。 */
const issueSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    state: { type: 'string', required: true, enum: ['open', 'closed'] },
    author: { type: 'string', required: true },
    url: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    labels: { type: 'array', required: true, items: { type: 'string' } },
    comments: { type: 'integer', required: true },
  },
} as const

/**
 * 注册 Issue 的两个工具。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerIssueTools(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取 GitHub Issue 列表，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_issue_list'),
      description:
        '列出仓库的 Issue（默认 open，按更新时间倒序，limit 默认 20、上限 100）。PR 会被过滤掉——GitHub 的 issues 接口会把 PR 也算作 issue。只读。',
      parameters: {
        ...slugParams,
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: '默认 open' },
        limit: { type: 'integer', description: '条数，默认 20，上限 100' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', required: true },
            repo: { type: 'string', required: true },
            state: { type: 'string', required: true },
            issues: { type: 'array', required: true, items: issueSummarySchema },
            count: { type: 'integer', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.issues.length === 0
                ? `${value.owner}/${value.repo}：没有 ${value.state} 状态的 Issue`
                : [
                    `${value.owner}/${value.repo}：${value.count} 个 Issue（${value.state}）`,
                    ...value.issues.map(
                      (issue) =>
                        `  #${issue.number} ${issue.title}（${issue.author}，${issue.comments} 条评论${
                          issue.labels.length === 0 ? '' : `，标签：${issue.labels.join('/')}`
                        }）`,
                    ),
                  ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const state = args.state ?? 'open'
          const issues = await ctx.github.listIssues(slug, {
            state,
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          return {
            owner: slug.owner,
            repo: slug.repo,
            state,
            issues: issues.map((issue) => ({
              number: issue.number,
              title: issue.title,
              state: issue.state,
              author: issue.author,
              url: issue.url,
              updatedAt: issue.updatedAt,
              labels: issue.labels,
              comments: issue.comments,
            })),
            count: issues.length,
            summary: `${issues.length} 个 Issue（${state}）`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_issue_list')
        }
      },
    }),
  )

  registerGitTool(
    ctx,
    'read',
    '读取 GitHub Issue 详情，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_issue_view'),
      description: '查看单个 Issue：标题、状态、作者、标签、评论数与正文。只读。',
      parameters: {
        ...slugParams,
        number: { type: 'integer', required: true, description: 'Issue 编号' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', required: true },
            repo: { type: 'string', required: true },
            number: { type: 'integer', required: true },
            title: { type: 'string', required: true },
            state: { type: 'string', required: true, enum: ['open', 'closed'] },
            author: { type: 'string', required: true },
            url: { type: 'string', required: true },
            labels: { type: 'array', required: true, items: { type: 'string' } },
            comments: { type: 'integer', required: true },
            body: { type: 'string', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `#${value.number} ${value.title}`,
              `${value.state} · ${value.author}${value.labels.length === 0 ? '' : ` · ${value.labels.join('/')}`}`,
              ...(value.body === '' ? [] : ['', value.body]),
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const issue = await ctx.github.getIssue(slug, args.number, exec.signal)
          return {
            owner: slug.owner,
            repo: slug.repo,
            number: issue.number,
            title: issue.title,
            state: issue.state,
            author: issue.author,
            url: issue.url,
            labels: issue.labels,
            comments: issue.comments,
            body: issue.body,
            summary: `#${issue.number} ${issue.title}（${issue.state}）`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_issue_view')
        }
      },
    }),
  )
}
