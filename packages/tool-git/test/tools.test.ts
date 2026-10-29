import type { Context } from '@deepseek-ai/cordis'
import type { RiskEntry } from 'dsh-git-core'
import { describe, expect, it } from 'vitest'
import { withPrefix } from '../src/define.js'
import { registerBlameTool } from '../src/tools/blame.js'
import { registerBranchTool } from '../src/tools/branch.js'
import { registerCommitTool } from '../src/tools/commit.js'
import { registerDiffTool } from '../src/tools/diff.js'
import { registerLogTool } from '../src/tools/log.js'
import { registerShowTool } from '../src/tools/show.js'
import { registerStageTool } from '../src/tools/stage.js'
import { registerStashTool } from '../src/tools/stash.js'
import { registerStatusTool } from '../src/tools/status.js'
import { registerUnstageTool } from '../src/tools/unstage.js'
import { registerWorktreeTool } from '../src/tools/worktree.js'

/**
 * 只实现 dsh-git 用到的两个服务方法的假上下文。
 *
 * `defineTool` 会在定义时校验参数与输出 schema，所以这个测试同时是
 * 「schema 是否落在 DSH 支持的子集内」的守卫。
 */
function fakeContext(): { ctx: Context; tools: string[]; risks: RiskEntry[] } {
  const tools: string[] = []
  const risks: RiskEntry[] = []
  const ctx = {
    tools: {
      register: (definition: { name: string }) => {
        tools.push(definition.name)
        return () => {}
      },
    },
    gitRisk: {
      register: (entry: RiskEntry) => {
        risks.push(entry)
      },
      get: () => undefined,
      entry: () => undefined,
    },
  } as unknown as Context
  return { ctx, tools, risks }
}

describe('工具注册', () => {
  it('注册 11 个工具，并把风险登记进 gitRisk', () => {
    const { ctx, tools, risks } = fakeContext()
    registerStatusTool(ctx, '')
    registerDiffTool(ctx, '')
    registerLogTool(ctx, '')
    registerShowTool(ctx, '')
    registerBlameTool(ctx, '')
    registerStageTool(ctx, '')
    registerUnstageTool(ctx, '')
    registerCommitTool(ctx, '')
    registerBranchTool(ctx, '')
    registerStashTool(ctx, '')
    registerWorktreeTool(ctx, '')

    expect(tools).toEqual([
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
      'git_blame',
      'git_stage',
      'git_unstage',
      'git_commit',
      'git_branch',
      'git_stash',
      'git_worktree',
    ])
    expect(risks.map((entry) => entry.tool)).toEqual(tools)
    expect(risks.every((entry) => (entry.summary ?? '') !== '')).toBe(true)
  })

  it('只读工具是 read，写工具是 write', () => {
    const { ctx, risks } = fakeContext()
    registerStatusTool(ctx, '')
    registerDiffTool(ctx, '')
    registerLogTool(ctx, '')
    registerShowTool(ctx, '')
    registerBlameTool(ctx, '')
    registerStageTool(ctx, '')
    registerUnstageTool(ctx, '')
    registerCommitTool(ctx, '')
    registerBranchTool(ctx, '')
    registerStashTool(ctx, '')
    registerWorktreeTool(ctx, '')

    const read = risks.filter((entry) => entry.risk === 'read').map((entry) => entry.tool)
    const write = risks.filter((entry) => entry.risk === 'write').map((entry) => entry.tool)
    expect(read).toEqual(['git_status', 'git_diff', 'git_log', 'git_show', 'git_blame'])
    expect(write).toEqual([
      'git_stage',
      'git_unstage',
      'git_commit',
      'git_branch',
      'git_stash',
      'git_worktree',
    ])
  })

  it('toolPrefix 会加在每个工具名前', () => {
    const { ctx, tools } = fakeContext()
    registerStatusTool(ctx, 'dshgit_')
    expect(tools).toEqual(['dshgit_git_status'])
  })
})

describe('withPrefix', () => {
  it('空前缀原样返回', () => {
    expect(withPrefix('', 'git_status')).toBe('git_status')
  })

  it('非空前缀直接拼接', () => {
    expect(withPrefix('dshgit_', 'git_status')).toBe('dshgit_git_status')
  })
})
