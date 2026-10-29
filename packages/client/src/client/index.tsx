/**
 * 客户端面板：Git 的两处界面。
 *
 * 1. **新对话那一排**（工作区名 / 模式）里的分支 chip：`ikuai8 → Git → 标准模式`；
 * 2. **对话中的视图切换器**里的第三个视图：`对话 → 轨迹 → Git`，内容是只读的仓库状态。
 *
 * 这个文件不是普通的 ESM 模块：DSH 的客户端插件是 **classic script**，
 * 必须由 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 包一层，
 * 且 `id` 必须与包名逐字一致（`dsh-git-client`）。包装由 `tsdown.client.config.ts` 的
 * banner/footer 完成，源码本身保持普通 TSX。
 *
 * 约束：
 * - 只能 `require` 宿主 module table 里的模块：react / react/jsx-runtime / @deepseek-ai/cordis；
 * - 与 host 通信走同源 `fetch('/api/dsh-git/<op>')`（cookie 鉴权自动带），
 *   与模型工具共用同一套 `ctx.git` 校验；
 * - 只读：写操作在 host 侧返回 501，界面不提供按钮（避免「UI 绕过审批」）。
 *
 * @module dsh-git-client/client
 */

import * as React from 'react'

/** 视图 id（`conversation.view` 的 id）。 */
export const PANEL_ID = 'git'

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
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  muted: { opacity: 0.65 } as React.CSSProperties,
  sectionTitle: { fontWeight: 600, marginTop: '4px' } as React.CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  } as React.CSSProperties,
  item: {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
    wordBreak: 'break-all',
  } as React.CSSProperties,
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

/** 分支图标。 */
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

/** chip 需要的最小快照。 */
interface ChipSnapshot {
  branch: string | null
  ahead: number
  behind: number
  changes: number
}

/** chip 外观：与工作区/模式 chip 同级，尽量只用继承色。 */
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  height: '24px',
  padding: '0 8px',
  borderRadius: '999px',
  border: '0.5px solid currentColor',
  color: 'inherit',
  opacity: 0.75,
  font: 'inherit',
  fontSize: '12px',
  lineHeight: '18px',
  maxWidth: '220px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
}

/**
 * 新对话那一排里的分支 chip：显示当前会话仓库的分支与未提交变更数。
 *
 * 没有 `sessionId`（还没进工作区）或仓库不可用时**什么都不画**：
 * 宿主对该容器有 `:empty { display: none }`，所以不会留空档。
 */
export function GitBranchChip(props: {
  sessionId?: string
  session?: { id?: string }
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
          changes:
            data.status.staged.length + data.status.unstaged.length + data.status.untracked.length,
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

  const label = snapshot.branch ?? 'detached'
  const track =
    snapshot.ahead === 0 && snapshot.behind === 0 ? '' : `↑${snapshot.ahead}↓${snapshot.behind}`
  const dirty = snapshot.changes === 0 ? '' : `·${snapshot.changes}`

  return (
    <span
      style={chipStyle}
      title={`${label}${track}${dirty === '' ? '' : `，${snapshot.changes} 个未提交变更`}`}
    >
      <BranchGlyph />
      <span>{label}</span>
      {track === '' ? null : <span>{track}</span>}
      {dirty === '' ? null : <span>{dirty}</span>}
    </span>
  )
}

/** 一组变更。 */
function ChangeGroup(props: { title: string; changes: Change[] }): React.ReactElement | null {
  if (props.changes.length === 0) return null
  return (
    <div>
      <div style={style.sectionTitle}>
        {props.title}（{props.changes.length}）
      </div>
      <ul style={style.list}>
        {props.changes.map((change) => (
          <li key={`${props.title}:${change.path}`} style={style.item}>
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
 * Git 视图：会话级、只读。
 *
 * `sessionId` 由槽位运行时注入，host 侧据此解析出该会话的工作目录，
 * 所以永远看的是「当前这个工作区」，不会去猜进程工作目录。
 */
export function GitPanel(props: {
  sessionId?: string
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

/** 客户端上下文里我们用到的部分。 */
interface ClientContext {
  slots: {
    inject(name: string, callback: () => () => void): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

/** 客户端插件名。 */
export const name = 'dsh-git-client'

/** 只依赖槽位服务。 */
export const inject = ['slots']

/**
 * 把「新对话」那一排里的 Git chip 挪到工作区与模式之间。
 *
 * 宿主的 `conversation.hero.workspace` 是 **single** 槽位（被工作区插件占用），
 * 那一排里唯一的 **list** 槽位是 `conversation.hero.options`，而它渲染在最后且带 `margin-left:auto`。
 * 所以只能靠 flex `order` 重排：工作区 chip 提到最前（-2），Git 容器居中（-1），模式保持默认（0）。
 *
 * 选择器用 `[class*="_xxx"]`：宿主 CSS module 的类名是 `<hash>_xxx`，写死哈希会在升级后失效。
 * 万一类名变了，最坏结果是 chip 退回最右（仍然可见），不会报错。
 */
function installChipStyles(): void {
  const styleId = 'dsh-git-chip-style'
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-dsh-git="${styleId}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.dshGit = styleId
  tag.textContent = [
    '[class*="_heroWorkspaceRow"] > button:first-child{order:-2}',
    '[class*="_heroOptions"]{order:-1;margin-left:0}',
  ].join('')
  document.head.appendChild(tag)
}

export function apply(ctx: ClientContext): void {
  /**
   * 逐个槽位注册并吞掉单个失败：某个槽位在别的 DSH 版本里形状不同，
   * 不应该连带把其余 UI 一起拖垮。
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

  // ── 1. 新对话那一排：ikuai8 → Git → 标准模式 ──
  safe('conversation.hero.options', () =>
    ctx.slots.inject('conversation.hero.options', () =>
      ctx.slots.register(
        {
          name: 'conversation.hero.options',
          id: 'dsh-git-branch',
          order: 10,
          inject: (sessionId: string) => ({ sessionId }),
        },
        GitBranchChip,
      ),
    ),
  )

  // ── 2. 对话中的视图切换器：对话 → 轨迹 → Git ──
  // `conversation.view` 是 list 槽位，宿主的 viewTabs() 直接读它的 id 与 label 生成 tab 按钮，
  // 所以 order 比轨迹（10）大一位就排在它右边。
  safe('conversation.view', () =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: PANEL_ID,
          order: 20,
          label: () => 'Git',
          inject: (sessionId: string) => ({ sessionId }),
        },
        GitPanel,
      ),
    ),
  )
}
