import { describe, expect, it } from 'vitest'
import {
  mapFile,
  mapFileChangeStatus,
  mapIssue,
  mapIssueDetail,
  mapPull,
  mapPullDetail,
  mapRepo,
  parseRemoteUrl,
  summarizeChecks,
  truncatePatch,
} from '../src/map.js'

describe('parseRemoteUrl', () => {
  it('识别 https 形式', () => {
    expect(parseRemoteUrl('https://github.com/deepseek-ai/dsh-git.git')).toEqual({
      owner: 'deepseek-ai',
      repo: 'dsh-git',
    })
    expect(parseRemoteUrl('https://github.com/o/r')).toEqual({ owner: 'o', repo: 'r' })
  })

  it('识别 ssh 的 scp 形式与 ssh:// 形式', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
    expect(parseRemoteUrl('ssh://git@ghe.example.com:2222/team/service.git')).toEqual({
      owner: 'team',
      repo: 'service',
    })
  })

  it('识别 GitHub Enterprise 的自定义域名', () => {
    expect(parseRemoteUrl('https://ghe.corp.local/group/project.git')).toEqual({
      owner: 'group',
      repo: 'project',
    })
  })

  it('无法识别时返回 null', () => {
    expect(parseRemoteUrl('')).toBeNull()
    expect(parseRemoteUrl('C:/repos/local-only')).toBeNull()
    expect(parseRemoteUrl('/srv/git/bare.git')).toBeNull()
  })
})

describe('mapPull / mapPullDetail', () => {
  const raw = {
    number: 12,
    title: 'feat: 支持 worktree',
    state: 'closed' as const,
    draft: true,
    merged_at: '2026-10-01T00:00:00Z',
    user: { login: 'octocat' },
    head: { ref: 'feat/x', sha: 'abc123' },
    base: { ref: 'main' },
    html_url: 'https://github.com/o/r/pull/12',
    updated_at: '2026-10-02T00:00:00Z',
    body: '说明',
    mergeable: true,
    additions: 10,
    deletions: 2,
    changed_files: 3,
    commits: 4,
    labels: [{ name: 'feature' }, {}],
  }

  it('merged_at 决定 state=merged，并透传 checks', () => {
    const summary = mapPull(raw, { total: 2, passed: 2, failed: 0, pending: 0 })
    expect(summary.state).toBe('merged')
    expect(summary.draft).toBe(true)
    expect(summary.author).toBe('octocat')
    expect(summary.head).toBe('feat/x')
    expect(summary.checks?.passed).toBe(2)
  })

  it('列表项不带 checks 时字段缺失而不是 undefined 值', () => {
    expect(mapPull(raw)).not.toHaveProperty('checks')
  })

  it('详情包含文件与标签（过滤空 label）', () => {
    const detail = mapPullDetail(raw, [
      { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
      { filename: 'old.ts', status: 'removed', previous_filename: 'old.ts' },
    ])
    expect(detail.files).toHaveLength(2)
    expect(detail.files[1]).toMatchObject({ path: 'old.ts', status: 'removed', additions: 0 })
    expect(detail.labels).toEqual(['feature'])
    expect(detail.changedFiles).toBe(3)
  })
})

describe('mapIssue / mapRepo', () => {
  it('映射 issue 摘要与详情', () => {
    const raw = {
      number: 7,
      title: 'bug: 崩溃',
      state: 'open' as const,
      user: { login: 'reporter' },
      html_url: 'https://github.com/o/r/issues/7',
      updated_at: '2026-10-03T00:00:00Z',
      labels: [{ name: 'bug' }],
      comments: 3,
      body: '复现步骤',
    }
    expect(mapIssue(raw)).toMatchObject({ number: 7, author: 'reporter', comments: 3, labels: ['bug'] })
    expect(mapIssueDetail(raw).body).toBe('复现步骤')
  })

  it('映射仓库概览，缺字段时给默认值', () => {
    expect(mapRepo({ name: 'dsh-git', full_name: 'deepseek-ai/dsh-git' })).toEqual({
      owner: 'deepseek-ai',
      repo: 'dsh-git',
      defaultBranch: 'main',
      visibility: 'public',
      archived: false,
      url: '',
      permissions: {},
    })
    expect(mapRepo({ name: 'x', private: true, archived: true })).toMatchObject({
      visibility: 'private',
      archived: true,
    })
  })
})

describe('summarizeChecks', () => {
  it('区分通过/失败/进行中', () => {
    const summary = summarizeChecks({
      total_count: 4,
      check_runs: [
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' },
        { status: 'completed', conclusion: 'failure' },
        { status: 'in_progress', conclusion: null },
      ],
    })
    expect(summary).toEqual({ total: 4, passed: 2, failed: 1, pending: 1 })
  })
})

describe('mapFileChangeStatus / truncatePatch', () => {
  it('把 GitHub 的 removed 翻成 deleted', () => {
    expect(mapFileChangeStatus('removed')).toBe('deleted')
    expect(mapFileChangeStatus('added')).toBe('added')
    expect(mapFileChangeStatus('weird')).toBe('modified')
  })

  it('未超上限时原样返回，超出时截断并标记', () => {
    expect(truncatePatch('abc', 10)).toEqual({ patch: 'abc', truncated: false })
    const truncated = truncatePatch('abcdef', 3)
    expect(truncated.truncated).toBe(true)
    expect(truncated.patch).toBe('abc')
  })

  it('mapFile 的 changes 缺省时用增删相加', () => {
    expect(mapFile({ filename: 'a', status: 'modified', additions: 2, deletions: 3 })).toMatchObject({
      changes: 5,
    })
  })
})
