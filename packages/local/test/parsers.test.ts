import { describe, expect, it } from 'vitest'
import { parseStatusV2 } from '../src/status.js'
import { parseNameStatus, parseNumStat } from '../src/diff.js'
import { parseLogLine } from '../src/log.js'
import { parseBlamePorcelain } from '../src/blame.js'
import { parseWorktreeList } from '../src/write.js'

/** 用 NUL 拼出一条 `git status --porcelain=v2 -z` 输出。 */
function porcelain(...records: string[]): string {
  return records.join('\0') + '\0'
}

describe('parseStatusV2', () => {
  it('把 ordinary / rename / unmerged / untracked 分到正确分组', () => {
    const stdout = porcelain(
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/a.ts',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new.ts',
      'src/old.ts',
      '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/b.ts',
      '? notes/untracked.md',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
    )

    const status = parseStatusV2(stdout)

    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
    expect(status.upstream).toBe('origin/main')

    expect(status.staged).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: true, binary: false },
      {
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        status: 'renamed',
        staged: true,
        binary: false,
      },
      { path: 'conflict.txt', status: 'unmerged', staged: true, binary: false },
    ])

    expect(status.unstaged).toEqual([
      { path: 'src/b.ts', status: 'modified', staged: false, binary: false },
      { path: 'conflict.txt', status: 'unmerged', staged: false, binary: false },
    ])

    expect(status.untracked).toEqual([
      { path: 'notes/untracked.md', status: 'untracked', staged: false, binary: false },
    ])
  })

  it('路径里带空格时按「前 7 个字段 + 余下全是路径」切分', () => {
    const stdout = porcelain('1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb dir with space/a b.ts')
    const status = parseStatusV2(stdout)
    expect(status.unstaged).toEqual([
      { path: 'dir with space/a b.ts', status: 'modified', staged: false, binary: false },
    ])
  })

  it('空仓库（没有 branch.ab）时 ahead/behind 为 0', () => {
    const status = parseStatusV2(porcelain('# branch.oid (initial)', '# branch.head main'))
    expect(status.ahead).toBe(0)
    expect(status.behind).toBe(0)
    expect(status.upstream).toBeNull()
  })
})

describe('parseNameStatus / parseNumStat', () => {
  it('解析普通与重命名条目', () => {
    const files = parseNameStatus('M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0A\0added.txt\0')
    expect(files).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false, binary: false },
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', staged: false, binary: false },
      { path: 'added.txt', status: 'added', staged: false, binary: false },
    ])
  })

  it('解析行数统计，并把 - 识别为二进制', () => {
    const stats = parseNumStat('3\t1\tsrc/a.ts\0-\t-\tlogo.png\0')
    expect(stats.get('src/a.ts')).toEqual({ additions: 3, deletions: 1, binary: false })
    expect(stats.get('logo.png')).toEqual({ binary: true })
  })

  it('重命名的 numstat 把路径拆成 old/new 两段', () => {
    const stats = parseNumStat('2\t2\t\0src/old.ts\0src/new.ts\0')
    expect(stats.get('src/new.ts')).toEqual({ additions: 2, deletions: 2, binary: false })
  })
})

describe('parseLogLine', () => {
  it('解析普通记录', () => {
    const line = '\u0001abc123\u001fabc\u001fAnn\u001fann@example.com\u001f2024-05-01T10:00:00+08:00\u001fparent1 parent2\u001ffix: 修正越界'
    const commit = parseLogLine(line)
    expect(commit).not.toBeNull()
    expect(commit?.sha).toBe('abc123')
    expect(commit?.author).toBe('Ann')
    expect(commit?.parents).toEqual(['parent1', 'parent2'])
    expect(commit?.subject).toBe('fix: 修正越界')
    expect(commit?.graph).toBeUndefined()
  })

  it('解析带 graph 前缀的记录，忽略纯连接线', () => {
    expect(parseLogLine('| * \u0001sha1\u001fs1\u001fA\u001fa@x\u001f2024-01-01T00:00:00Z\u001f\u001fs')).toMatchObject({
      graph: '| * ',
      parents: [],
    })
    expect(parseLogLine('|/')).toBeNull()
  })
})

describe('parseBlamePorcelain', () => {
  it('解析 header、author 与内容行', () => {
    const stdout = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
      'author Ann',
      'author-mail <ann@example.com>',
      'author-time 1714000000',
      'author-tz +0800',
      'summary init',
      'filename a.txt',
      '\tline one',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
      'author Bob',
      'author-time 1714000100',
      'author-tz +0800',
      '\tline two',
      '',
    ].join('\n')

    const lines = parseBlamePorcelain(stdout)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ line: 1, author: 'Ann', content: 'line one' })
    expect(lines[0]?.shortSha).toBe('aaaaaaa')
    expect(lines[1]).toMatchObject({ line: 2, author: 'Bob', content: 'line two' })
  })
})

describe('parseWorktreeList', () => {
  it('识别主工作树、detached 与 locked', () => {
    const stdout = [
      'worktree D:/repo',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree D:/repo/.worktrees/feat',
      'HEAD bbbb',
      'detached',
      'locked reason',
      '',
    ].join('\n')

    const worktrees = parseWorktreeList(stdout)
    expect(worktrees).toHaveLength(2)
    expect(worktrees[0]).toMatchObject({ path: 'D:/repo', branch: 'main', main: true, detached: false })
    expect(worktrees[1]).toMatchObject({ branch: null, detached: true, locked: true, main: false })
  })
})
