import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * 用 `vm` 模拟 DSH 的 `window.__ModuleLoader__`：
 * 不启动浏览器，也能验证「id 与包名一致、require 只取宿主表里的模块、
 * apply 把 chip 与 Git 视图注册到正确的槽位」。
 *
 * 这三件事都是**运行时**才报错的（没有编译期检查），所以必须有一条这样的测试。
 */

const CLIENT_PATH = new URL('../lib/client.js', import.meta.url)

/** 允许出现在 require 里的 specifier（宿主 module table 的 seed）。 */
const ALLOWED_REQUIRES = new Set(['react', 'react/jsx-runtime'])

interface LoadedBundle {
  id: string
  exports: Record<string, unknown>
  required: string[]
}

function loadBundle(): LoadedBundle {
  let source: string
  try {
    source = readFileSync(CLIENT_PATH, 'utf8')
  } catch {
    throw new Error('找不到 packages/client/lib/client.js —— 先跑 `pnpm build`')
  }

  const required: string[] = []
  let loaded: { id: string; exports: Record<string, unknown> } | undefined

  const fakeReact = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: <T,>(initial: T) => [initial, () => {}],
    useCallback: <T,>(fn: T) => fn,
    useEffect: () => {},
    Fragment: 'Fragment',
  }
  const fakeJsxRuntime = {
    jsx: (type: unknown, props: unknown) => ({ type, props }),
    jsxs: (type: unknown, props: unknown) => ({ type, props }),
    Fragment: 'Fragment',
  }

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry: { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }) {
          const exports = entry.factory((spec: string) => {
            required.push(spec)
            if (spec === 'react') return fakeReact
            if (spec === 'react/jsx-runtime') return fakeJsxRuntime
            throw new Error(`unexpected require: ${spec}`)
          })
          loaded = { id: entry.id, exports }
        },
      },
    },
    // 客户端插件会插一条 <style>；沙箱里给个最小 document 即可
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
    },
  }

  createContext(sandbox)
  runInContext(source, sandbox)

  if (loaded === undefined) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
  return { ...loaded, required }
}

describe('客户端 bundle（lib/client.js）', () => {
  it('id 与包名逐字一致', () => {
    expect(loadBundle().id).toBe('dsh-git-client')
  })

  it('只 require 宿主 module table 里的模块', () => {
    for (const spec of loadBundle().required) {
      expect(ALLOWED_REQUIRES.has(spec)).toBe(true)
    }
  })

  it('导出 cordis 插件三件套，只依赖 slots', () => {
    const { exports } = loadBundle()
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots'])
    expect(exports.name).toBe('dsh-git-client')
    expect(exports.PANEL_ID).toBe('git')
  })

  it('apply 注册两个槽位：新对话的 chip + 对话中的 Git 视图', () => {
    const { exports } = loadBundle()
    const slots: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const injected: string[] = []

    const ctx = {
      slots: {
        inject(name: string, callback: () => () => void) {
          injected.push(name)
          callback()
        },
        register(options: Record<string, unknown>, component: unknown) {
          slots.push({ options, component })
          return () => {}
        },
      },
    }

    ;(exports.apply as (context: unknown) => void)(ctx)

    expect(injected).toEqual(['conversation.hero.options', 'conversation.view'])

    // 1. 新对话那一排的 chip（位置靠注入的 CSS order 调整）
    expect(slots[0]?.options).toMatchObject({
      name: 'conversation.hero.options',
      id: 'dsh-git-branch',
    })
    expect(typeof slots[0]?.options.inject).toBe('function')
    expect(typeof slots[0]?.component).toBe('function')

    // 2. 视图切换器里的第三个视图：order 必须大于轨迹的 10
    expect(slots[1]?.options).toMatchObject({ name: 'conversation.view', id: 'git', order: 20 })
    expect((slots[1]?.options.label as () => string)()).toBe('Git')
    expect(typeof slots[1]?.component).toBe('function')
  })

  it('不再注册左侧全局页或右侧栏 tab（位置已由 chip + 视图承担）', () => {
    const { exports } = loadBundle()
    const injected: string[] = []
    const ctx = {
      slots: {
        inject(name: string, callback: () => () => void) {
          injected.push(name)
          callback()
        },
        register: () => () => {},
      },
    }
    ;(exports.apply as (context: unknown) => void)(ctx)
    for (const forbidden of [
      'sidebar.panellist',
      'main',
      'sidebar.right.pane.tab',
      'conversation.input.left',
    ]) {
      expect(injected).not.toContain(forbidden)
    }
  })
})
