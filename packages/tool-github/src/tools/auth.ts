/**
 * `gh_auth_status`：认证状态（只读，绝不返回 token）。
 *
 * @module dsh-git-tool-github/tools/auth
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { asToolError, nullableString } from '../support.js'

/**
 * 注册 `gh_auth_status`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerAuthStatusTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取 GitHub 认证状态，不发出任何写请求',
    defineTool({
      name: withPrefix(prefix, 'gh_auth_status'),
      description:
        '检查 GitHub 认证是否可用：返回是否已配置、登录名与 token 的 scopes（不会返回 token 本身）。失败时给出可执行的修复提示。只读。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            configured: { type: 'boolean', required: true },
            login: nullableString,
            scopes: { type: 'array', required: true, items: { type: 'string' } },
            hint: { type: 'string' },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.configured && value.login !== null
                ? `GitHub 已认证：${value.login}（scopes：${value.scopes.length === 0 ? '未声明' : value.scopes.join(', ')}）`
                : `GitHub 未认证：${value.hint ?? '未配置 token'}`,
          },
        ],
      },
      async execute(_args, exec) {
        try {
          const status = await ctx.github.authStatus(exec.signal)
          return {
            configured: status.configured,
            login: status.login ?? null,
            scopes: status.scopes,
            ...(status.hint === undefined ? {} : { hint: status.hint }),
            summary: status.configured
              ? `已认证${status.login === undefined ? '' : `：${status.login}`}`
              : '未认证，需要配置 token',
          }
        } catch (error) {
          throw asToolError(error, 'gh_auth_status')
        }
      },
    }),
  )
}
