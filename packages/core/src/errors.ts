/**
 * 结构化错误模型：Provider 只抛 {@link GitError}，工具层把它转成可执行提示。
 *
 * @module dsh-git-core/errors
 */

/** 所有可预期的失败类别。新增类别需要在 docs/03 §11 同步登记。 */
export type GitErrorCode =
  | 'not-a-repo'
  | 'path-outside-repo'
  | 'invalid-ref'
  | 'command-failed'
  | 'timeout'
  | 'output-too-large'
  | 'auth-missing'
  | 'rate-limited'
  | 'network'
  | 'unsupported'

/** 错误的补充信息：只放诊断用的短字段，绝不放凭据。 */
export interface GitErrorDetail {
  /** 子进程退出码（非 0 时） */
  exitCode?: number
  /** 子进程 stderr 的尾部（已脱敏、已截断） */
  stderr?: string
  /** 给模型/用户看的可执行建议 */
  hint?: string
}

/**
 * dsh-git 唯一的错误类型。
 *
 * `message` 面向人，`detail.hint` 面向「下一步该做什么」，
 * `code` 面向策略与测试断言。
 */
export class GitError extends Error {
  readonly code: GitErrorCode
  readonly detail: GitErrorDetail

  constructor(code: GitErrorCode, message: string, detail: GitErrorDetail = {}) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.detail = detail
  }

  /** 供工具层序列化到 `output` 的最小形状。 */
  toJSON(): { code: GitErrorCode; message: string } & GitErrorDetail {
    return { code: this.code, message: this.message, ...this.detail }
  }
}

/** 判断任意捕获值是否是 {@link GitError}。 */
export function isGitError(value: unknown): value is GitError {
  return value instanceof GitError
}
