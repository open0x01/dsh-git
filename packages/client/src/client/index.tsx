/**
 * 客户端面板：右侧边栏的 Git tab（只读）。
 *
 * 这个文件不是普通的 ESM 模块：DSH 的客户端插件是 **classic script**，
 * 必须由 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 包一层，
 * 且 `id` 必须与包名逐字一致（`dsh-git-client`）。包装由 `tsdown.config.ts` 的
 * banner/footer 完成，源码本身保持普通 TSX。
 *
 * 约束：
 * - 只能 `require` 宿主 module table 里的模块：react / react/jsx-runtime / @deepseek-ai/cordis；
 * - 与 host 通信走同源 `fetch('/api/dsh-git/<op>')`（cookie 鉴权自动带），
 *   与模型工具共用同一套 `ctx.git` 校验；
 * - v0.1 只读：写操作在 host 侧返回 501，面板不提供按钮（避免「UI 绕过审批」）。
 *
 * @module dsh-git-client/client
 */

import * as React from 'react'

/** 面板 id：既是 tab 类型的 id，也是 `sidebar.right.pane.tab` 与 `.title` 两个槽位的 key。 */
export const PANEL_ID = 'dsh-git'

/** RPC 前缀，与 host 侧 `dsh-git-client.rpcPath` 默认值一致。 */
export const RPC_PATH = '/api/dsh-git'

/** 一个文件变更（与 core 的 FileChange 对应，这里只声明用到的字段）。 */
interface Change {
  path: string
  oldPath?: string
  status: string
  staged: boolean
  additions?: number
  deletions?: number
  binary: boolean
}

/** 一条提交。 */
interface Commit {
  shortSha: string
  author: string
  date: string
  subject: string
}

/** `snapshot` op 的返回。 */
export interface Snapshot {
  repo: { root: string; branch: string | null; operation: string | null; head: string | null }
  status: {
    staged: Change[]
    unstaged: Change[]
    untracked: Change[]
    ahead: number
    behind: number
    upstream: string | null
  }
  commits: Commit[]
}

/** 调一次 host RPC。 */
async function callRpc<T>(op: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${RPC_PATH}/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  const payload = (await response.json()) as {
    ok: boolean
    data?: T
    error?: { code: string; message: string; hint?: string }
  }
  if (!response.ok || payload.ok !== true) {
    const message = payload.error?.message ?? `HTTP ${response.status}`
    const hint = payload.error?.hint
    throw new Error(hint === undefined ? message : `${message}（${hint}）`)
  }
  return payload.data as T
}

const STATUS_LABEL: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  unmerged: 'U',
  untracked: '?',
}

const style = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '12px',
    fontSize: '12px',
    lineHeight: '1.5',
    height: '100%',
    overflow: 'auto',
    color: 'inherit',
  } as React.CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' } as React.CSSProperties,
  muted: { opacity: 0.65 } as React.CSSProperties,
  sectionTitle: { fontWeight: 600, marginTop: '4px' } as React.CSSProperties,
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' } as React.CSSProperties,
  item: { display: 'flex', gap: '6px', alignItems: 'baseline', wordBreak: 'break-all' } as React.CSSProperties,
  badge: {
    flex: '0 0 auto',
    width: '14px',
    textAlign: 'center',
    fontWeight: 600,
    opacity: 0.8,
  } as React.CSSProperties,
  button: {
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    opacity: 0.8,
  } as React.CSSProperties,
  error: { color: '#d9534f', wordBreak: 'break-word' } as React.CSSProperties,
}

/** tab 类型在「+」菜单里的图标。 */
function GitIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.5 5v6M5 3.5h4a3 3 0 0 1 3 3v1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 一组变更。 */
function ChangeGroup({ title, changes }: { title: string; changes: Change[] }): React.ReactElement | null {
  if (changes.length === 0) return null
  return (
    <div>
      <div style={style.sectionTitle}>
        {title}（{changes.length}）
      </div>
      <ul style={style.list}>
        {changes.map((change) => (
          <li key={`${title}:${change.path}`} style={style.item}>
            <span style={style.badge}>{STATUS_LABEL[change.status] ?? '·'}</span>
            <span>{change.path}</span>
            {change.additions === undefined ? null : (
              <span style={style.muted}>
                +{change.additions}/-{change.deletions ?? 0}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 面板主体。
 *
 * 右侧栏是**按会话**的：`sessionId` 由槽位运行时注入，host 侧据此解析出该会话的
 * 工作目录，所以面板永远看的是「当前这个工作区」，不会去猜进程工作目录。
 */
export function GitPanel(props: {
  sessionId?: string
  /** 有些版本把会话放在 `session` 对象里，这里两种都认 */
  session?: { id?: string }
}): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const sessionId = props.sessionId ?? props.session?.id

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await callRpc<Snapshot>('snapshot', sessionId === undefined ? {} : { sessionId })
      setSnapshot(data)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  if (error !== null) {
    return (
      <div style={style.root}>
        <div style={style.error}>{error}</div>
        <button type="button" style={style.button} onClick={() => void refresh()}>
          重试
        </button>
      </div>
    )
  }

  if (snapshot === null) {
    return <div style={style.root}>{loading ? '读取仓库状态…' : '没有数据'}</div>
  }

  const { repo, status, commits } = snapshot
  const total = status.staged.length + status.unstaged.length + status.untracked.length

  return (
    <div style={style.root}>
      <div style={style.row}>
        <strong>{repo.branch ?? 'detached HEAD'}</strong>
        <button type="button" style={style.button} onClick={() => void refresh()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      <div style={style.muted}>
        {repo.root}
        {status.upstream === null ? '' : ` · ${status.upstream} +${status.ahead}/-${status.behind}`}
        {repo.operation === null ? '' : ` · ${repo.operation}`}
      </div>

      {total === 0 ? <div style={style.muted}>工作区干净</div> : null}
      <ChangeGroup title="已暂存" changes={status.staged} />
      <ChangeGroup title="未暂存" changes={status.unstaged} />
      <ChangeGroup title="未跟踪" changes={status.untracked} />

      {commits.length === 0 ? null : (
        <div>
          <div style={style.sectionTitle}>最近提交</div>
          <ul style={style.list}>
            {commits.map((commit) => (
              <li key={commit.shortSha} style={style.item}>
                <span style={style.badge}>{commit.shortSha.slice(0, 5)}</span>
                <span>{commit.subject}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={style.muted}>写操作请在对话里让模型调用 git_commit 等工具（会走审批）。</div>
    </div>
  )
}

/** 右侧栏 tab 的 chip 标题。 */
export function GitTitle(): React.ReactElement {
  return <span>Git</span>
}

/** 客户端上下文里我们用到的部分。 */
interface ClientContext {
  slots: {
    inject(name: string, callback: () => () => void): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  sidebarRightTabs: {
    register(definition: Record<string, unknown>): () => void
  }
}

/** 客户端插件名。 */
export const name = 'dsh-git-client'

/** 依赖：槽位服务与右侧栏 tab 注册表。 */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * 注册右侧栏的 Git tab（会话级，而不是左侧的全局页）。
 *
 * 两段式注册（与官方 tab 类型一致）：
 * 1. `sidebarRightTabs.register` 声明「这是什么类型」——kind、标题、`+` 菜单里的入口；
 * 2. `sidebar.right.pane.tab` / `…title` 用同一个 id 注册「内容与标题怎么画」。
 *
 * @param ctx - 客户端上下文
 */
export function apply(ctx: ClientContext): void {
  ctx.sidebarRightTabs.register({
    id: PANEL_ID,
    kind: 'git',
    priority: 'extension',
    title: () => 'Git',
    guide: [
      {
        id: 'git',
        order: 60,
        title: () => 'Git',
        description: () => '当前会话仓库的变更与最近提交',
        icon: GitIcon,
      },
    ],
  })

  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: PANEL_ID,
      },
      GitPanel,
    ),
  )

  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab.title',
        key: PANEL_ID,
      },
      GitTitle,
    ),
  )
}
