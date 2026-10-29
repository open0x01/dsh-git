/**
 * 与 Provider 无关的领域类型。Provider 与 Consumer 都只依赖这里的形状。
 *
 * @module dsh-git-core/types
 */

/** 一次操作的可选取消信号，由工具层透传 `exec.signal`。 */
export interface Abortable {
  signal?: AbortSignal
}

/** 一个已解析的仓库。`root` 是 realpath 之后的绝对路径。 */
export interface RepoRef {
  /** 工作区根目录（realpath 后）；worktree 场景下是 worktree 自己的根 */
  root: string
  /** 当前分支名；detached HEAD 时为 null */
  branch: string | null
  /** 是否处于 merge/rebase/cherry-pick/revert 中间态 */
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  /** HEAD 指向的 commit；空仓库（unborn branch）时为 null */
  head: string | null
}

/** diff 的四种目标。 */
export type DiffTarget =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; sha: string }
  | { kind: 'range'; from: string; to: string }

/** 单个文件的变更描述。 */
export interface FileChange {
  /** 相对仓库根的路径（正斜杠） */
  path: string
  /** 重命名/复制的来源路径 */
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged' | 'untracked'
  /** 是否已进入索引 */
  staged: boolean
  /** 新增行数；二进制文件或未跟踪文件为 undefined */
  additions?: number
  /** 删除行数；二进制文件或未跟踪文件为 undefined */
  deletions?: number
  /** 是否为二进制文件 */
  binary: boolean
}

/** 一次 diff 的结果。 */
export interface DiffResult {
  files: FileChange[]
  /** unified diff 文本；超过 maxOutputBytes 时被截断 */
  patch: string
  /** patch 是否被截断 */
  truncated: boolean
  /** 截断时完整输出的落盘位置；未实现落盘时为 undefined */
  spillPath?: string
}

/** 一条提交摘要。 */
export interface CommitInfo {
  sha: string
  shortSha: string
  author: string
  authorEmail: string
  /** ISO 8601 带时区偏移 */
  date: string
  subject: string
  /** 父提交 sha 列表；根提交为空数组 */
  parents: string[]
  /** 提交图前缀（`graph: true` 时有值，例如 `* `、`|\ `） */
  graph?: string
}

/** 一行 blame 结果。 */
export interface BlameLine {
  /** 1 起的行号 */
  line: number
  sha: string
  shortSha: string
  author: string
  /** ISO 8601 带时区偏移 */
  date: string
  /** 该行内容（不含换行符） */
  content: string
}

/** `status` 的返回。 */
export interface StatusResult {
  /** 已暂存（索引）的变更 */
  staged: FileChange[]
  /** 工作区已修改但未暂存 */
  unstaged: FileChange[]
  /** 未跟踪文件 */
  untracked: FileChange[]
  /** 相对上游的领先提交数；无上游时为 0 */
  ahead: number
  /** 相对上游的落后提交数；无上游时为 0 */
  behind: number
  /** 上游分支名，无上游时为 null */
  upstream: string | null
  /** 合并/变基等中间态，来自 RepoRef */
  operation: RepoRef['operation']
}

/** `branch` 工具的动作。 */
export type BranchAction =
  | { action: 'list' }
  | { action: 'create'; name: string; from?: string }
  | { action: 'switch'; name: string }
  | { action: 'delete'; name: string; force?: boolean }

/** 一个本地分支。 */
export interface BranchInfo {
  name: string
  current: boolean
  /** 分支指向的 commit sha */
  sha: string
  /** 上游分支，例如 `origin/main` */
  upstream: string | null
  /** 相对上游的领先/落后 */
  ahead: number
  behind: number
}

/** `stash` 工具的动作。 */
export type StashAction =
  | { action: 'list' }
  | { action: 'save'; message?: string; includeUntracked?: boolean }
  | { action: 'pop'; index?: number }
  | { action: 'drop'; index?: number }

/** 一条 stash 记录。 */
export interface StashEntry {
  index: number
  sha: string
  message: string
  branch: string
}

/** `worktree` 工具的动作。 */
export type WorktreeAction =
  | { action: 'list' }
  | { action: 'create'; path?: string; branch?: string; createBranch?: boolean }
  | { action: 'remove'; path: string }

/** 一个工作树。 */
export interface WorktreeInfo {
  path: string
  head: string
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  /** 是否为主工作树 */
  main: boolean
  /** 是否存在未提交变更（仅 list 时按需计算） */
  dirty?: boolean
}

/** `show` 的返回。 */
export interface ShowResult {
  commit: CommitInfo
  diff: DiffResult
}

/** 一个远端。 */
export interface RemoteInfo {
  name: string
  /** fetch URL */
  url: string
  /** push URL；与 fetch URL 相同时为 null */
  pushUrl: string | null
}

/** `log` 的可选参数。 */
export interface LogOptions extends Abortable {
  limit?: number
  paths?: string[]
  graph?: boolean
  since?: string
}

/** `diff` 的可选参数。 */
export interface DiffOptions extends Abortable {
  paths?: string[]
  contextLines?: number
  statOnly?: boolean
}

/** `status` 的可选参数。 */
export interface StatusOptions extends Abortable {
  paths?: string[]
}
