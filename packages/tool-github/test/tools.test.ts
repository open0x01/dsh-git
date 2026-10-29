import type { Context } from '@deepseek-ai/cordis'
import type { RiskEntry } from 'dsh-git-core'
import { describe, expect, it } from 'vitest'
import { registerAuthStatusTool } from '../src/tools/auth.js'
import { registerIssueTools } from '../src/tools/issues.js'
import { registerPullTools } from '../src/tools/pulls.js'
import { registerRepoViewTool } from '../src/tools/repo.js'

/** 只实现 dsh-git 用到的两个服务方法的假上下文。 */
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

function registerAll(ctx: Context): void {
  registerAuthStatusTool(ctx, '')
  registerRepoViewTool(ctx, '')
  registerPullTools(ctx, '')
  registerIssueTools(ctx, '')
}

describe('GitHub 工具注册', () => {
  it('注册 8 个 gh_* 工具', () => {
    const { ctx, tools } = fakeContext()
    registerAll(ctx)
    expect(tools).toEqual([
      'gh_auth_status',
      'gh_repo_view',
      'gh_pr_list',
      'gh_pr_view',
      'gh_pr_diff',
      'gh_pr_create',
      'gh_issue_list',
      'gh_issue_view',
    ])
  })

  it('只有 gh_pr_create 是 network-write，其余是 read', () => {
    const { ctx, risks } = fakeContext()
    registerAll(ctx)
    const byRisk = risks.reduce<Record<string, string[]>>((acc, entry) => {
      acc[entry.risk] = [...(acc[entry.risk] ?? []), entry.tool]
      return acc
    }, {})
    expect(byRisk.read).toHaveLength(7)
    expect(byRisk['network-write']).toEqual(['gh_pr_create'])
    expect(risks.every((entry) => (entry.summary ?? '') !== '')).toBe(true)
  })

  it('toolPrefix 生效', () => {
    const { ctx, tools } = fakeContext()
    registerAuthStatusTool(ctx, 'dshgit_')
    expect(tools).toEqual(['dshgit_gh_auth_status'])
  })
})
