import { describe, expect, it } from 'vitest'
import { decidePolicy, type Config } from '../src/index.js'

const config: Config = {
  rules: { read: 'allow', write: 'ask', 'network-write': 'deny' },
  allowTools: [],
  denyTools: [],
}

describe('decidePolicy', () => {
  it('未登记的工具不归本插件管，直接放行', () => {
    expect(decidePolicy(config, 'bash', undefined)).toEqual({
      decision: 'allow',
      source: 'unknown-tool',
    })
  })

  it('按风险等级套用规则', () => {
    expect(decidePolicy(config, 'git_status', 'read').decision).toBe('allow')
    expect(decidePolicy(config, 'git_commit', 'write').decision).toBe('ask')
    expect(decidePolicy(config, 'git_push', 'network-write').decision).toBe('deny')
  })

  it('denyTools 优先级最高，allowTools 次之', () => {
    const custom: Config = {
      ...config,
      allowTools: ['git_commit'],
      denyTools: ['git_status'],
    }
    expect(decidePolicy(custom, 'git_status', 'read')).toEqual({
      decision: 'deny',
      source: 'denyTools',
    })
    expect(decidePolicy(custom, 'git_commit', 'write')).toEqual({
      decision: 'allow',
      source: 'allowTools',
    })
  })

  it('规则可整体改成 deny 或 allow', () => {
    const strict: Config = {
      ...config,
      rules: { read: 'deny', write: 'deny', 'network-write': 'deny' },
    }
    expect(decidePolicy(strict, 'git_diff', 'read').decision).toBe('deny')

    const loose: Config = {
      ...config,
      rules: { read: 'allow', write: 'allow', 'network-write': 'ask' },
    }
    expect(decidePolicy(loose, 'git_commit', 'write').decision).toBe('allow')
    expect(decidePolicy(loose, 'git_push', 'network-write').decision).toBe('ask')
  })
})
