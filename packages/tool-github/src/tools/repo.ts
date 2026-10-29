/**
 * `gh_repo_view`：仓库概览（只读）。
 *
 * @module dsh-git-tool-github/tools/repo
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { asToolError, resolveSlug, slugParams } from '../support.js'

/**
 * 注册 `gh_repo_view`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerRepoViewTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取 GitHub 仓库元数据，不改变任何内容',
    defineTool({
      name: withPrefix(prefix, 'gh_repo_view'),
      description:
        '查看 GitHub 仓库：默认分支、可见性、是否归档、URL、当前 token 的权限。owner/repo 省略时从当前仓库的 git remote 推导。只读。',
      parameters: { ...slugParams },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', required: true },
            repo: { type: 'string', required: true },
            defaultBranch: { type: 'string', required: true },
            visibility: { type: 'string', required: true },
            archived: { type: 'boolean', required: true },
            url: { type: 'string', required: true },
            permissions: {
              type: 'object',
              additionalProperties: true,
              required: true,
              properties: {},
            },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `${value.owner}/${value.repo}（${value.visibility}${value.archived ? '，已归档' : ''}）`,
              `默认分支：${value.defaultBranch}`,
              `URL：${value.url}`,
              `权限：${Object.entries(value.permissions)
                .filter(([, allowed]) => allowed)
                .map(([name]) => name)
                .join(', ') || '只读'}`,
            ].join('\n'),
          },
        ],
      },
      async execute(args, exec) {
        try {
          const slug = await resolveSlug(ctx, exec, args.owner, args.repo, args.repoDir)
          const view = await ctx.github.repoView(slug, exec.signal)
          return {
            owner: view.owner,
            repo: view.repo,
            defaultBranch: view.defaultBranch,
            visibility: view.visibility,
            archived: view.archived,
            url: view.url,
            permissions: view.permissions,
            summary: `${view.owner}/${view.repo}（${view.visibility}），默认分支 ${view.defaultBranch}`,
          }
        } catch (error) {
          throw asToolError(error, 'gh_repo_view')
        }
      },
    }),
  )
}
