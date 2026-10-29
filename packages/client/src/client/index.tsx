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

/** 分支图标（与面板里那个同一套线条）。 */
function BranchGlyph(props: { size?: number }): React.ReactElement {
  const size = props.size ?? 14
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.5 5v6M5 3.5h4a3 3 0 0 1 3 3v1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 输入区里那个分支 chip 需要的最小快照。 */
interface ChipSnapshot {
  branch: string | null
  ahead: number
  behind: number
  changes: number
}

/** chip 的外观：与输入区其他 chip 同级，尽量只用继承色。 */
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  height: '24px',
  padding: '0 8px',
  borderRadius: '999px',
  border: '0.5px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  opacity: 0.75,
  font: 'inherit',
  fontSize: '12px',
  lineHeight: '18px',
  cursor: 'pointer',
  maxWidth: '220px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
}

/**
 * 输入区里的 Git 分支 chip：显示当前会话仓库的分支与未提交变更数，点击打开右侧栏 Git tab。
 *
 * 没有 `sessionId`（还没选工作区/会话）或仓库不可用时**什么都不画**，
 * 不去猜目录，也不显示错误——输入区不该被一个红字占位。
 */
export function GitBranchChip(props: {
  sessionId?: string
  session?: { id?: string }
  sidebarRight?: { commandTarget?: (element: Element | null) => unknown; openTabFromTarget?: (kind: string, target: unknown) => void }
}): React.ReactElement | null {
  const sessionId = props.sessionId ?? props.session?.id
  const [snapshot, setSnapshot] = React.useState<ChipSnapshot | null>(null)

  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') {
      setSnapshot(null)
      return
    }
    let cancelled = false
    callRpc<Snapshot>('snapshot', { sessionId })
      .then((data) => {
        if (cancelled) return
        setSnapshot({
          branch: data.repo.branch,
          ahead: data.status.ahead,
          behind: data.status.behind,
          changes: data.status.staged.length + data.status.unstaged.length + data.status.untracked.length,
        })
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (snapshot === null) return null

  const openPanel = (element: Element | null): void => {
    const service = props.sidebarRight
    if (service?.commandTarget === undefined || service.openTabFromTarget === undefined) return
    try {
      const target = service.commandTarget(element)
      if (target !== undefined) service.openTabFromTarget('git', target)
    } catch {
      // 打不开面板不影响 chip 本身
    }
  }

  const label = snapshot.branch ?? 'detached'
  const track = snapshot.ahead === 0 && snapshot.behind === 0 ? '' : ` ↑${snapshot.ahead}↓${snapshot.behind}`
  const dirty = snapshot.changes === 0 ? '' : ` · ${snapshot.changes}`

  return (
    <button
      type="button"
      style={chipStyle}
      title={`${label}${track}${dirty === '' ? '' : `，${snapshot.changes} 个未提交变更`}（点击打开 Git 面板）`}
      onClick={(event) => openPanel(event.currentTarget)}
    >
      <BranchGlyph />
      <span>{label}</span>
      {track === '' ? null : <span>{track.trim()}</span>}
      {dirty === '' ? null : <span>{dirty.trim()}</span>}
    </button>
  )
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
  sidebarRight?: {
    commandTarget?: (element: Element | null) => unknown
    openTabFromTarget?: (kind: string, target: unknown) => void
  }
}

/** 客户端插件名。 */
export const name = 'dsh-git-client'

/** 依赖：槽位服务与右侧栏 tab 注册表。 */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * 注册三处界面：
 * 1. 输入区里的**分支 chip**（`conversation.hero.options` 是「工作区名 + 模式」那一排，
 *    `conversation.input.left` 是开始对话后的输入框左侧），点它打开右侧栏面板；
 * 2. 右侧栏 tab 类型（`sidebarRightTabs.register` + 两个 keyed 槽位），画详情。
 *
 * @param ctx - 客户端上下文
 */
/**
 * 把「新对话」那一排里的 Git chip 挪到最前面。
 *
 * 宿主把 `conversation.hero.options` 渲染成那一排的最后一个子元素，并且带 `margin-left:auto`
 * （推到最右）。这里用 flex 的 `order` 把它提到第一个，并清掉自动外边距，
 * 于是顺序变成：Git → 项目 → 标准模式。
 *
 * 选择器用 `[class*="_heroOptions"]`：宿主 CSS module 的类名是 `<hash>_heroOptions`，
 * 直接写死哈希会在升级后失效。容器为空时宿主自己会 `display:none`，所以没有仓库时不会留空档。
 */
function installChipStyles(): void {
  const styleId = 'dsh-git-chip-style'
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-dsh-git="${styleId}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.dshGit = styleId
  tag.textContent = '[class*="_heroOptions"]{order:-1;margin-left:0}'
  document.head.appendChild(tag)
}

export function apply(ctx: ClientContext): void {
  /**
   * 逐个槽位注册并吞掉单个失败：某个槽位在别的 DSH 版本里形状不同（例如要 `key` 而不是 `id`），
   * 不应该连带把面板和 chip 一起拖垮。
   */
  const safe = (label: string, register: () => void): void => {
    try {
      register()
    } catch (error) {
      // 客户端没有 logger 通道，用 console 留痕，便于在浏览器里排查
      console.warn(`[dsh-git] 注册 ${label} 失败：`, error)
    }
  }

  safe('chip styles', installChipStyles)

  // ── 1. 分支 chip ──
  // 新对话：那一排的最前面（Git → 项目 → 标准模式）
  // 对话中：最上方一行、轨迹右侧的动作区
  const chipOptions = {
    id: 'dsh-git-branch',
    order: 10,
    inject: (sessionId: string) => ({ sessionId, sidebarRight: ctx.sidebarRight }),
  }
  safe('conversation.hero.options', () =>
    ctx.slots.inject('conversation.hero.options', () =>
      ctx.slots.register({ name: 'conversation.hero.options', ...chipOptions }, GitBranchChip),
    ),
  )
  safe('conversation.session.header.actions', () =>
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', ...chipOptions, order: 5 },
        GitBranchChip,
      ),
    ),
  )

  // ── 2. 右侧栏 tab：类型 + 内容 + 标题 ──
  safe('sidebarRightTabs.register', () =>
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
    }),
  )

  safe('sidebar.right.pane.tab', () =>
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID }, GitPanel),
    ),
  )

  safe('sidebar.right.pane.tab.title', () =>
    ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PANEL_ID }, GitTitle),
    ),
  )
}
