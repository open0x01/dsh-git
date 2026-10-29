import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside, normalizePaths, resolveInsideRepo, toRepoRelative } from '../src/paths.js'

const root = resolve('C:/work/repo')

describe('isInside', () => {
  it('接受根目录本身与内部路径', () => {
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, resolve(root, 'src/a.ts'))).toBe(true)
  })

  it('拒绝前缀相同但不同级的兄弟目录', () => {
    expect(isInside(root, resolve('C:/work/repo-evil/a.ts'))).toBe(false)
    expect(isInside(root, resolve('C:/work/other/a.ts'))).toBe(false)
  })
})

describe('resolveInsideRepo', () => {
  it('相对路径按仓库根解析', () => {
    expect(resolveInsideRepo(root, 'src/a.ts')).toBe(resolve(root, 'src/a.ts'))
  })

  it('用 .. 越界时抛 path-outside-repo', () => {
    expect(() => resolveInsideRepo(root, '../outside.txt')).toThrowError(
      expect.objectContaining({ code: 'path-outside-repo' }),
    )
    expect(() => resolveInsideRepo(root, 'src/../../outside.txt')).toThrowError(
      expect.objectContaining({ code: 'path-outside-repo' }),
    )
  })

  it('绝对路径越界同样拒绝', () => {
    expect(() => resolveInsideRepo(root, resolve('C:/Windows/system32'))).toThrowError(
      expect.objectContaining({ code: 'path-outside-repo' }),
    )
  })
})

describe('toRepoRelative / normalizePaths', () => {
  it('统一成正斜杠的相对路径', () => {
    expect(toRepoRelative(root, resolve(root, 'src/nested/a.ts'))).toBe('src/nested/a.ts')
  })

  it('批量规范化并保留顺序', () => {
    expect(normalizePaths(root, ['b.txt', 'src/a.ts'])).toEqual(['b.txt', 'src/a.ts'])
  })
})
