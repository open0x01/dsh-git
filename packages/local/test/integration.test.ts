import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blameRepo } from '../src/blame.js'
import { diffRepo } from '../src/diff.js'
import { logRepo } from '../src/log.js'
import { resolveRepo } from '../src/repo.js'
import { runGit, type RunOptions } from '../src/runner.js'
import { parseStatusV2 } from '../src/status.js'
import { showRepo } from '../src/show.js'
import {
  branchAction,
  commitChanges,
  stagePaths,
  stashAction,
  unstagePaths,
  worktreeAction,
  type WriteContext,
} from '../src/write.js'

/** 固定的小超时，避免测试挂死。 */
const run: Pick<RunOptions, 'timeoutMs' | 'maxOutputBytes' | 'env'> = {
  timeoutMs: 20_000,
  maxOutputBytes: 4 * 1024 * 1024,
  env: {},
}

const read = { gitPath: 'git', run }
const write: WriteContext = { gitPath: 'git', run, worktreeRoot: '.worktrees', allowNoVerify: false }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

let repoRoot = ''
/** realpath 之后的形式（Windows 上可能把 8.3 短名展开成长名） */
let realRoot = ''

/** 读一次真实的 `git status --porcelain=v2` 并解析。 */
async function statusOf(cwd: string) {
  const result = await runGit(
    'git',
    ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'],
    { ...run, cwd },
  )
  return parseStatusV2(result.stdout)
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-git-test-'))
  repoRoot = join(base, 'repo')
  await mkdir(repoRoot, { recursive: true })
  git(repoRoot, 'init', '-b', 'main')
  git(repoRoot, 'config', 'user.name', 'Test User')
  git(repoRoot, 'config', 'user.email', 'test@example.com')
  git(repoRoot, 'config', 'commit.gpgsign', 'false')

  await writeFile(join(repoRoot, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
  await writeFile(join(repoRoot, 'b.txt'), 'b1\n', 'utf8')
  git(repoRoot, 'add', '-A')
  git(repoRoot, 'commit', '-m', 'chore: 初始提交')
  realRoot = await realpath(repoRoot)
})

afterAll(async () => {
  if (repoRoot === '') return
  await rm(dirname(repoRoot), { recursive: true, force: true })
})

describe('resolveRepo', () => {
  it('解析出 realpath 后的根、分支与 HEAD', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    expect(repo.branch).toBe('main')
    expect(repo.operation).toBeNull()
    expect(repo.head).toMatch(/^[0-9a-f]{40}$/)
    expect(repo.root.toLowerCase()).toBe(realRoot.toLowerCase())
  })

  it('子目录也能解析到同一个仓库根', async () => {
    const nested = join(repoRoot, 'nested', 'deep')
    await mkdir(nested, { recursive: true })
    const repo = await resolveRepo(nested, { ...read, allowedRoots: [] })
    expect(repo.root.toLowerCase()).toBe(realRoot.toLowerCase())
  })

  it('非仓库目录抛 not-a-repo', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-git-norepo-'))
    await expect(resolveRepo(outside, { ...read, allowedRoots: [] })).rejects.toMatchObject({
      code: 'not-a-repo',
    })
    await rm(outside, { recursive: true, force: true })
  })

  it('allowedRoots 不含该仓库时抛 path-outside-repo', async () => {
    await expect(
      resolveRepo(repoRoot, { ...read, allowedRoots: [join(tmpdir(), 'somewhere-else')] }),
    ).rejects.toMatchObject({ code: 'path-outside-repo' })
  })
})

describe('status + diff 四种目标', () => {
  it('区分已暂存 / 未暂存 / 未跟踪', async () => {
    await writeFile(join(repoRoot, 'a.txt'), 'one\ntwo changed\nthree\n', 'utf8')
    await writeFile(join(repoRoot, 'b.txt'), 'b1\nb2\n', 'utf8')
    await writeFile(join(repoRoot, 'c-untracked.txt'), 'new\n', 'utf8')
    git(repoRoot, 'add', 'b.txt')

    const status = await statusOf(repoRoot)
    expect(status.staged.map((change) => change.path)).toEqual(['b.txt'])
    expect(status.unstaged.map((change) => change.path)).toEqual(['a.txt'])
    expect(status.untracked.map((change) => change.path)).toEqual(['c-untracked.txt'])

    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const staged = await diffRepo(read, repo, { kind: 'staged' })
    expect(staged.files.map((file) => file.path)).toEqual(['b.txt'])
    expect(staged.files[0]?.additions).toBe(1)
    expect(staged.patch).toContain('+b2')

    const unstaged = await diffRepo(read, repo, { kind: 'unstaged' })
    expect(unstaged.files.map((file) => file.path)).toEqual(['a.txt'])
    expect(unstaged.patch).toContain('+two changed')
  })

  it('commit 目标返回对应补丁', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const head = git(repoRoot, 'rev-parse', 'HEAD').trim()

    const commitDiff = await diffRepo(read, repo, { kind: 'commit', sha: head })
    expect(commitDiff.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt'])
    expect(commitDiff.patch).toContain('+one')
  })

  it('statOnly 不返回补丁文本', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const result = await diffRepo(read, repo, { kind: 'unstaged' }, { statOnly: true })
    expect(result.patch).toBe('')
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('paths 过滤只返回指定路径', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const result = await diffRepo(read, repo, { kind: 'unstaged' }, { paths: ['a.txt'] })
    expect(result.files.map((file) => file.path)).toEqual(['a.txt'])
  })
})

describe('log / show / blame', () => {
  it('log 返回新到旧的提交，并支持 limit', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const commits = await logRepo(read, repo, { limit: 10 })
    expect(commits.length).toBe(1)
    expect(commits[0]?.subject).toBe('chore: 初始提交')
    expect(commits[0]?.parents).toEqual([])
  })

  it('show 返回元数据与补丁', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const head = git(repoRoot, 'rev-parse', 'HEAD').trim()
    const result = await showRepo(read, repo, head)
    expect(result.commit.sha).toBe(head)
    expect(result.diff.patch).toContain('+one')
    expect(result.diff.files.length).toBe(2)
  })

  it('show 对不存在的提交抛 invalid-ref', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    await expect(showRepo(read, repo, 'deadbeefdeadbeef')).rejects.toMatchObject({ code: 'invalid-ref' })
  })

  it('blame 返回逐行归属，可限定行范围', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const lines = await blameRepo(read, repo, 'b.txt')
    expect(lines.map((line) => line.line)).toEqual([1, 2])
    expect(lines[0]?.author).toBe('Test User')

    const ranged = await blameRepo(read, repo, 'a.txt', { start: 1, end: 2 })
    expect(ranged.map((line) => line.line)).toEqual([1, 2])
  })
})

describe('写操作', () => {
  it('stage / unstage 改变索引而不改工作区', async () => {
    await unstagePaths(write, await resolveRepo(repoRoot, { ...read, allowedRoots: [] }), ['b.txt'])
    let status = await statusOf(repoRoot)
    expect(status.staged).toEqual([])
    expect(status.unstaged.map((change) => change.path).sort()).toEqual(['a.txt', 'b.txt'])

    await stagePaths(write, await resolveRepo(repoRoot, { ...read, allowedRoots: [] }), ['b.txt'])
    status = await statusOf(repoRoot)
    expect(status.staged.map((change) => change.path)).toEqual(['b.txt'])
  })

  it('commit 保留多行说明，只提交已暂存内容', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const result = await commitChanges(write, repo, {
      message: 'feat: 第二个提交\n\n正文第二行，含 $() 与 "引号"。',
    })
    expect(result.summary).toBe('feat: 第二个提交')
    expect(result.filesChanged).toBe(1)

    const commits = await logRepo(read, await resolveRepo(repoRoot, { ...read, allowedRoots: [] }), {
      limit: 5,
    })
    expect(commits.length).toBe(2)
    expect(commits[0]?.subject).toBe('feat: 第二个提交')
    expect(commits[0]?.parents.length).toBe(1)

    // 两次提交之间的 range diff：只有 b.txt 变了
    const rootCommit = commits[1]?.sha ?? ''
    const rangeDiff = await diffRepo(
      read,
      await resolveRepo(repoRoot, { ...read, allowedRoots: [] }),
      { kind: 'range', from: rootCommit, to: commits[0]?.sha ?? '' },
    )
    expect(rangeDiff.files.map((file) => file.path)).toEqual(['b.txt'])
    expect(rangeDiff.patch).toContain('+b2')
  })

  it('非法分支名被拒绝，合法分支可创建并切回', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    await expect(
      branchAction(write, repo, { action: 'create', name: '--upload-pack=evil' }),
    ).rejects.toMatchObject({ code: 'invalid-ref' })

    const created = await branchAction(write, repo, { action: 'create', name: 'feat/x' })
    expect(created.map((branch) => branch.name)).toContain('feat/x')
    expect(created.find((branch) => branch.current)?.name).toBe('main')

    const switched = await branchAction(write, repo, { action: 'switch', name: 'feat/x' })
    expect(switched.find((branch) => branch.current)?.name).toBe('feat/x')

    await branchAction(write, repo, { action: 'switch', name: 'main' })
  })

  it('stash save / list / pop 往返', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const saved = await stashAction(write, repo, { action: 'save', message: 'wip: 测试' })
    expect(saved.length).toBe(1)
    expect(saved[0]?.message).toContain('wip: 测试')

    const popped = await stashAction(write, repo, { action: 'pop' })
    expect(popped).toEqual([])

    const status = await statusOf(repoRoot)
    expect(status.unstaged.map((change) => change.path)).toContain('a.txt')
  })

  it('worktree create 落在 worktreeRoot 下，remove 后列表恢复', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    const created = await worktreeAction(write, repo, { action: 'create', branch: 'wt-feat' })
    expect(created.length).toBe(2)
    const extra = created.find((entry) => !entry.main)
    expect(extra?.path).toBeDefined()
    expect(extra?.path).toContain('.worktrees')

    const removed = await worktreeAction(write, repo, { action: 'remove', path: extra?.path ?? '' })
    expect(removed.length).toBe(1)
  })

  it('拒绝删除主工作树', async () => {
    const repo = await resolveRepo(repoRoot, { ...read, allowedRoots: [] })
    await expect(
      worktreeAction(write, repo, { action: 'remove', path: repo.root }),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })
})
