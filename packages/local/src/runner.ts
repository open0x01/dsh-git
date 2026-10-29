/**
 * 子进程执行器：唯一允许调用 git 的地方。
 *
 * 红线（docs/08 ADR-002）：`spawn(git, argv, { shell: false })`，参数永远是数组，
 * 任何路径/分支名/提交说明都只作为单个 argv 元素传递，永不拼接字符串。
 *
 * @module dsh-git-local/runner
 */

import { spawn } from 'node:child_process'
import { GitError } from 'dsh-git-core'

/** 单次执行的可调参数。 */
export interface RunOptions {
  /** 子进程工作目录 */
  cwd: string
  /** 取消信号（工具层透传 exec.signal） */
  signal?: AbortSignal
  /** 超时（毫秒） */
  timeoutMs: number
  /** stdout 上限（字节） */
  maxOutputBytes: number
  /** 通过 stdin 写入的内容（例如 commit message） */
  input?: string
  /** 追加的环境变量 */
  env?: Record<string, string>
}

/** 单次执行的结果。非 0 退出码不抛错，由调用方决定语义。 */
export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  /** stdout 是否被上限截断 */
  truncated: boolean
}

/** stderr 只保留尾部这么多字节，避免错误信息本身撑爆上下文。 */
const STDERR_LIMIT = 8 * 1024

/**
 * 需要从继承环境里剔除的变量。
 *
 * 这些变量会把 git 指向另一个仓库或另一套对象库，导致「解析出来的仓库」
 * 与「实际操作的仓库」不一致——这正是越权操作最容易发生的地方。
 */
const STRIPPED_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]

/**
 * 构造干净、可预测的 git 环境。
 *
 * 固定项：禁用交互式提问、禁用 pager、禁用编辑器、禁用颜色。
 * @param extra - 配置里追加的环境变量（最后写入，可覆盖默认值）
 * @returns 传给 spawn 的环境对象
 */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of STRIPPED_ENV) delete env[key]
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_ASKPASS = ''
  env.GIT_PAGER = 'cat'
  env.PAGER = 'cat'
  env.GIT_EDITOR = 'true'
  env.GIT_MERGE_AUTOEDIT = 'no'
  env.GIT_OPTIONAL_LOCKS = '1'
  return Object.assign(env, extra)
}

/**
 * 全局生效的 `-c` 覆盖，保证输出可解析（不改用户仓库配置）。
 *
 * 只覆盖**输出格式**相关的项：路径不转义、关颜色、关签名展示。
 */
export const GIT_OUTPUT_CONFIG = [
  '-c',
  'core.quotepath=false',
  '-c',
  'color.ui=false',
  '-c',
  'log.showSignature=false',
  '-c',
  'diff.noprefix=false',
] as const

/**
 * 执行一次 git 命令。
 *
 * @param gitPath - git 可执行文件
 * @param args - argv 数组（不含 `-c` 覆盖）
 * @param options - 超时、上限、stdin、取消
 * @returns 退出码与输出；非 0 退出码不抛错
 * @throws GitError `timeout` / `command-failed` / `unsupported`
 */
export function runGit(gitPath: string, args: string[], options: RunOptions): Promise<RunResult> {
  const { cwd, signal, timeoutMs, maxOutputBytes, input } = options
  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GitError('command-failed', '操作已取消'))
      return
    }

    let child
    try {
      child = spawn(gitPath, [...GIT_OUTPUT_CONFIG, ...args], {
        cwd,
        shell: false,
        env: gitEnv(options.env),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (cause) {
      reject(
        new GitError('unsupported', `无法启动 git（${gitPath}）`, {
          hint: '检查 git 是否安装，或在 dsh-git-local 配置里设置 gitPath',
          stderr: String(cause),
        }),
      )
      return
    }

    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let truncated = false
    let stderr = ''
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(() =>
        reject(
          new GitError('timeout', `git 命令超时（${timeoutMs}ms）：${args.join(' ')}`, {
            hint: '缩小查询范围（例如加 paths 或降低 limit），或调大 dsh-git-local.timeoutMs',
          }),
        ),
      )
    }, timeoutMs)

    const onAbort = () => {
      child.kill()
      finish(() => reject(new GitError('command-failed', '操作已取消', { hint: '调用方已取消该操作' })))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= maxOutputBytes) {
        truncated = true
        return
      }
      const remaining = maxOutputBytes - stdoutBytes
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining))
        stdoutBytes += remaining
        truncated = true
        return
      }
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.length
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > STDERR_LIMIT) stderr = stderr.slice(-STDERR_LIMIT)
    })

    child.on('error', (cause: NodeJS.ErrnoException) => {
      finish(() => {
        if (cause.code === 'ENOENT') {
          reject(
            new GitError('unsupported', `找不到 git 可执行文件：${gitPath}`, {
              hint: '安装 git，或在 dsh-git-local 配置里把 gitPath 指向 git 可执行文件',
            }),
          )
          return
        }
        reject(
          new GitError('command-failed', `启动 git 失败：${cause.message}`, {
            hint: '检查 gitPath 与执行权限',
          }),
        )
      })
    })

    child.on('close', (code) => {
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr,
          exitCode: code ?? -1,
          truncated,
        }),
      )
    })

    if (input !== undefined) {
      child.stdin?.end(input, 'utf8')
    } else {
      child.stdin?.end()
    }
  })
}

/**
 * 执行并要求成功退出；失败转成 {@link GitError}。
 *
 * @param gitPath - git 可执行文件
 * @param args - argv 数组
 * @param options - 执行参数
 * @param hint - 失败时给用户看的建议
 * @returns 成功的结果
 * @throws GitError `command-failed`
 */
export async function runGitOk(
  gitPath: string,
  args: string[],
  options: RunOptions,
  hint?: string,
): Promise<RunResult> {
  const result = await runGit(gitPath, args, options)
  if (result.exitCode !== 0) {
    const detail: { exitCode: number; stderr?: string; hint?: string } = { exitCode: result.exitCode }
    if (result.stderr.trim() !== '') detail.stderr = result.stderr.trim()
    if (hint !== undefined) detail.hint = hint
    throw new GitError('command-failed', `git ${args.join(' ')} 失败`, detail)
  }
  return result
}
