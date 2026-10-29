/**
 * PR 相关工具：`gh_pr_list` / `gh_pr_view` / `gh_pr_diff` / `gh_pr_create`。
 *
 * @module dsh-git-tool-github/tools/pulls
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import {
  asToolError,
  checksSchema,
  describeChecks,
  resolveSlug,
  resolveToolRepo,
  slugParams,
} from '../support.js'

/** 列表项 schema。 */
const pullSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    state: { type: 'string', required: true, enum: ['open', 'closed', 'merged'] },
    draft: { type: 'boolean', required: true },
    author: { type: 'string', required: true },
    head: { type: 'string', required: true },
    base: { type: 'string', required: true },
    url: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    checks: checksSchema,
  },
} as const

/** 文件 schema。 */
const pullFileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    status: { type: 'string', required: true },
    additions: { type: 'integer', required: true },
    deletions: { type: 'integer', required: true },
    changes: { type: 'integer', required: true },
  },
} as const

/** 状态参数。 */
const stateParam = {
  type: 'string',
  enum: ['open', 'closed', 'all'],
  description: '默认 open',
} as const

/**
 * 注册 PR 的四个工具。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerPullTools(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取 GitHub PR 列表，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_pr_list'),
      description:
        '列出仓库的 PR（默认 open，按更新时间倒序，limit 默认 20、上限 100）。owner/repo 省略时从 git remote 推导。只读。',
      parameters: {
        ...slugParams,
        state: stateParam,
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
            pulls: { type: 'array', required: true, items: pullSummarySchema },
            count: { type: 'integer', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.pulls.length === 0
                ? `${value.owner}/${value.repo}：没有 ${value.state} 状态的 PR`
                : [
                    `${value.owner}/${value.repo}：${value.count} 个 PR（${value.state}）`,
                    ...value.pulls.map(
                      (pull) =>
                        `  #${pull.number} ${pull.draft ? '[draft] ' : ''}${pull.title}（${pull.author}，${pull.head} → ${pull.base}）`,
                    ),
                  ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const state = args.state ?? 'open'
          const pulls = await ctx.github.listPulls(slug, {
            state,
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          return {
            owner: slug.owner,
            repo: slug.repo,
            state,
            pulls: pulls.map((pull) => ({
              number: pull.number,
              title: pull.title,
              state: pull.state,
              draft: pull.draft,
              author: pull.author,
              head: pull.head,
              base: pull.base,
              url: pull.url,
              updatedAt: pull.updatedAt,
              ...(pull.checks === undefined ? {} : { checks: pull.checks }),
            })),
            count: pulls.length,
            summary: `${pulls.length} 个 PR（${state}）`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_pr_list')
        }
      },
    }),
  )

  registerGitTool(
    ctx,
    'read',
    '读取 GitHub PR 详情，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_pr_view'),
      description:
        '查看单个 PR：标题、作者、分支、mergeable、增删行数、变更文件清单与 CI 检查汇总。只读。',
      parameters: {
        ...slugParams,
        number: { type: 'integer', required: true, description: 'PR 编号' },
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
            state: { type: 'string', required: true, enum: ['open', 'closed', 'merged'] },
            draft: { type: 'boolean', required: true },
            author: { type: 'string', required: true },
            head: { type: 'string', required: true },
            base: { type: 'string', required: true },
            url: { type: 'string', required: true },
            body: { type: 'string', required: true },
            mergeable: {
              oneOf: [{ type: 'boolean' }, { type: 'null' }],
              required: true,
            },
            additions: { type: 'integer', required: true },
            deletions: { type: 'integer', required: true },
            changedFiles: { type: 'integer', required: true },
            commits: { type: 'integer', required: true },
            labels: { type: 'array', required: true, items: { type: 'string' } },
            files: { type: 'array', required: true, items: pullFileSchema },
            checks: checksSchema,
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => {
          const head = [
            `#${value.number} ${value.title}`,
            `${value.state}${value.draft ? '（draft）' : ''} · ${value.author} · ${value.head} → ${value.base}`,
            `+${value.additions}/-${value.deletions}，${value.changedFiles} 个文件，${value.commits} 个提交` +
              (value.mergeable === null ? '' : value.mergeable ? ' · 可合并' : ' · 有冲突'),
            ...(value.checks === undefined ? [] : [describeChecks(value.checks)]),
            '',
            ...value.files.map(
              (file) => `  ${file.status} ${file.path} (+${file.additions}/-${file.deletions})`,
            ),
            ...(value.body === '' ? [] : ['', value.body]),
          ]
          return [{ type: 'text', text: head.join('\n') }]
        },
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const pull = await ctx.github.getPull(slug, args.number, exec.signal)
          return {
            owner: slug.owner,
            repo: slug.repo,
            number: pull.number,
            title: pull.title,
            state: pull.state,
            draft: pull.draft,
            author: pull.author,
            head: pull.head,
            base: pull.base,
            url: pull.url,
            body: pull.body,
            mergeable: pull.mergeable,
            additions: pull.additions,
            deletions: pull.deletions,
            changedFiles: pull.changedFiles,
            commits: pull.commits,
            labels: pull.labels,
            files: pull.files.map((file) => ({
              path: file.path,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
            })),
            ...(pull.checks === undefined ? {} : { checks: pull.checks }),
            summary: `#${pull.number} ${pull.title}（${pull.state}）`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_pr_view')
        }
      },
    }),
  )

  registerGitTool(
    ctx,
    'read',
    '读取 GitHub PR 的 diff，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_pr_diff'),
      description:
        '拉取 PR 的 unified diff（受 maxFiles / maxDiffBytes 限制，超出会标记 truncated）。回答「这个 PR 改了什么」时用它。只读。',
      parameters: {
        ...slugParams,
        number: { type: 'integer', required: true, description: 'PR 编号' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', required: true },
            repo: { type: 'string', required: true },
            number: { type: 'integer', required: true },
            files: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                  additions: { type: 'integer' },
                  deletions: { type: 'integer' },
                },
              },
            },
            patch: { type: 'string', required: true },
            truncated: { type: 'boolean', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `#${value.number}：${value.files.length} 个文件` + (value.truncated ? '（patch 已截断）' : ''),
              ...value.files.map((file) => `  ${file.status} ${file.path}`),
              ...(value.patch === '' ? [] : ['', '```diff', value.patch, '```']),
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const diff = await ctx.github.pullDiff(slug, args.number, exec.signal)
          return {
            owner: slug.owner,
            repo: slug.repo,
            number: args.number,
            files: diff.files.map((file) => ({
              path: file.path,
              status: file.status,
              ...(file.additions === undefined ? {} : { additions: file.additions }),
              ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
            })),
            patch: diff.patch,
            truncated: diff.truncated,
            summary: `#${args.number}：${diff.files.length} 个文件` + (diff.truncated ? '（已截断）' : ''),
          }
        } catch (error) {
          throw asToolError(error, 'gh_pr_diff')
        }
      },
    }),
  )

  registerGitTool(
    ctx,
    'network-write',
    '在 GitHub 上创建 PR，会在远端产生新对象',
    defineTool({
      name: withPrefix(prefix, 'gh_pr_create'),
      description:
        '创建 PR（默认 draft，避免误触发评审与 CI 门禁）。head 省略时用当前分支。这是联网写操作，策略默认 deny，需要在配置里改成 ask/allow。',
      parameters: {
        ...slugParams,
        title: { type: 'string', required: true, description: 'PR 标题' },
        base: { type: 'string', required: true, description: '目标分支' },
        head: { type: 'string', description: '来源分支；省略时用当前分支' },
        body: { type: 'string', description: 'PR 描述' },
        draft: { type: 'boolean', description: '是否 draft（默认 true）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', required: true },
            repo: { type: 'string', required: true },
            number: { type: 'integer', required: true },
            url: { type: 'string', required: true },
            draft: { type: 'boolean', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `已创建${value.draft ? ' draft ' : ' '}PR #${value.number}：${value.url}`,
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          let head = args.head
          if (head === undefined || head === '') {
            const repo = await resolveToolRepo(ctx, exec, args.repoDir)
            if (repo.branch === null) {
              throw new Error('当前处于 detached HEAD，必须显式给 head')
            }
            head = repo.branch
          }
          const pull = await ctx.github.createPull(slug, {
            title: args.title,
            head,
            base: args.base,
            ...(args.body === undefined ? {} : { body: args.body }),
            draft: args.draft ?? true,
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          return {
            owner: slug.owner,
            repo: slug.repo,
            number: pull.number,
            url: pull.url,
            draft: pull.draft,
            summary: `已创建 PR #${pull.number}（${pull.draft ? 'draft' : 'ready'}）`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_pr_create')
        }
      },
    }),
  )
}
