/**
 * `git_diff`：只读，返回文件清单 + unified patch。
 *
 * @module dsh-git-tool-git/tools/diff
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DiffTarget } from 'dsh-git-core'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGitTool, withPrefix } from '../define.js'
import { fileChangesSchema, pathsParam, repoDirParam } from '../schema.js'
import { asToolError, describeChange, resolveToolRepo, toFileChangeValue } from '../support.js'

/** 把扁平参数翻译成领域里的 `DiffTarget`。 */
function targetFrom(args: {
  target?: string
  sha?: string
  from?: string
  to?: string
}): DiffTarget {
  const kind = args.target ?? 'unstaged'
  if (kind === 'unstaged') return { kind: 'unstaged' }
  if (kind === 'staged') return { kind: 'staged' }
  if (kind === 'commit') {
    if (args.sha === undefined || args.sha.trim() === '') {
      throw new Error('target=commit 时必须给 sha')
    }
    return { kind: 'commit', sha: args.sha }
  }
  if (kind === 'range') {
    if (args.from === undefined || args.to === undefined) {
      throw new Error('target=range 时必须同时给 from 与 to')
    }
    return { kind: 'range', from: args.from, to: args.to }
  }
  throw new Error(`未知的 target：${kind}（可用：unstaged / staged / commit / range）`)
}

/**
 * 注册 `git_diff`。
 *
 * @param ctx - 插件上下文
 * @param prefix - 工具名前缀
 */
export function registerDiffTool(ctx: Context, prefix: string): void {
  registerGitTool(
    ctx,
    'read',
    '读取 diff，不改变任何文件',
    defineTool({
      name: withPrefix(prefix, 'git_diff'),
      description:
        '查看差异：target=unstaged（工作区未暂存）/ staged（已暂存）/ commit（某个提交，需 sha）/ range（两个引用之间，需 from 与 to）。返回文件清单与 unified patch。只读。',
      parameters: {
        repoDir: repoDirParam,
        target: {
          type: 'string',
          enum: ['unstaged', 'staged', 'commit', 'range'],
          description: '默认 unstaged',
        },
        sha: { type: 'string', description: 'target=commit 时的提交 sha 或引用' },
        from: { type: 'string', description: 'target=range 的起点引用' },
        to: { type: 'string', description: 'target=range 的终点引用' },
        paths: pathsParam,
        contextLines: { type: 'integer', description: 'patch 的上下文行数（默认 git 的 3）' },
        statOnly: { type: 'boolean', description: '只要统计，不要 patch 文本' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true },
            target: { type: 'string', required: true },
            files: { ...fileChangesSchema, required: true },
            patch: { type: 'string', required: true },
            truncated: { type: 'boolean', required: true },
            summary: { type: 'string', required: true },
          },
        },
        render: (_args, value) => {
          const head = [
            `${value.target}：${value.files.length} 个文件` + (value.truncated ? '（patch 已截断）' : ''),
            ...value.files.map((file) => `  - ${describeChange(file)}`),
          ]
          const body = value.patch === '' ? [] : ['', '```diff', value.patch, '```']
          return [{ type: 'text', text: [...head, ...body].join('\n') }]
        },
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `git diff (${args.target ?? 'unstaged'})`,
        kind: 'other',
        rawInput: args,
      }),
      async execute(args, exec) {
        try {
          const repo = await resolveToolRepo(ctx, exec, args.repoDir)
          const target = targetFrom(args)
          const result = await ctx.git.diff(repo, target, {
            ...(args.paths === undefined ? {} : { paths: args.paths }),
            ...(args.contextLines === undefined ? {} : { contextLines: args.contextLines }),
            ...(args.statOnly === undefined ? {} : { statOnly: args.statOnly }),
            signal: exec.signal,
          })
          const label =
            target.kind === 'commit'
              ? `commit ${target.sha}`
              : target.kind === 'range'
                ? `range ${target.from}..${target.to}`
                : target.kind
          const summary =
            result.files.length === 0
              ? `${label}：没有差异`
              : `${label}：${result.files.length} 个文件` + (result.truncated ? '（patch 被截断）' : '')
          return {
            root: repo.root,
            target: label,
            files: result.files.map(toFileChangeValue),
            patch: result.patch,
            truncated: result.truncated,
            summary,
          }
        } catch (error) {
          throw asToolError(error, 'git_diff')
        }
      },
    }),
  )
}
