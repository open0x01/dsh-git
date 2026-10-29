import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * 用 `vm` 模拟 DSH 的 `window.__ModuleLoader__`：
 * 不启动浏览器，也能验证「id 与包名一致、require 只取宿主表里的模块、
 * apply 注册了右侧栏 tab 的三个部件」。
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

  it('导出 cordis 插件三件套，inject 声明 slots 与 sidebarRightTabs', () => {
    const { exports } = loadBundle()
    expect(typeof exports.apply).toBe('function')
    expect(exports.inject).toEqual(['slots', 'sidebarRightTabs'])
    expect(exports.name).toBe('dsh-git-client')
    expect(exports.PANEL_ID).toBe('dsh-git')
  })

  it('apply 注册 tab 类型 + 内容 + 标题（右侧栏，会话级）', () => {
    const { exports } = loadBundle()
    const tabTypes: Array<Record<string, unknown>> = []
    const slots: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const injected: string[] = []

    const ctx = {
      sidebarRightTabs: {
        register(definition: Record<string, unknown>) {
          tabTypes.push(definition)
          return () => {}
        },
      },
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

    // 1. tab 类型：kind / 标题 / 引导入口
    expect(tabTypes).toHaveLength(1)
    const definition = tabTypes[0]
    expect(definition).toMatchObject({ id: 'dsh-git', kind: 'git', priority: 'extension' })
    expect((definition?.title as () => string)()).toBe('Git')
    const guide = definition?.guide as Array<Record<string, unknown>>
    expect(guide).toHaveLength(1)
    expect((guide[0]?.title as () => string)()).toBe('Git')
    expect(typeof guide[0]?.icon).toBe('function')

    // 2. 内容与标题两个 keyed 槽位
    expect(injected).toEqual(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
    expect(slots).toHaveLength(2)
    expect(slots[0]?.options).toMatchObject({ name: 'sidebar.right.pane.tab', key: 'dsh-git' })
    expect(slots[1]?.options).toMatchObject({ name: 'sidebar.right.pane.tab.title', key: 'dsh-git' })
    expect(typeof slots[0]?.component).toBe('function')
    expect(typeof slots[1]?.component).toBe('function')
  })

  it('不再注册左侧全局页（sidebar.panellist / main）', () => {
    const { exports } = loadBundle()
    const injected: string[] = []
    const ctx = {
      sidebarRightTabs: { register: () => () => {} },
      slots: {
        inject(name: string, callback: () => () => void) {
          injected.push(name)
          callback()
        },
        register: () => () => {},
      },
    }
    ;(exports.apply as (context: unknown) => void)(ctx)
    expect(injected).not.toContain('sidebar.panellist')
    expect(injected).not.toContain('main')
  })
})
