/**
 * `dsh-git-github` 的配置项。
 *
 * @module dsh-git-github/config
 */

import z from '@deepseek-ai/schemastery'

/** 配置。 */
export interface Config {
  /** 凭据引用名（不是值） */
  tokenRef: string
  /** API 基地址；GitHub Enterprise 可改 */
  baseUrl: string
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /** 读操作 ETag 缓存 TTL（毫秒） */
  cacheTtlMs: number
  /** PR diff 最多返回的文件数 */
  maxFiles: number
  /** PR diff 文本上限（字节） */
  maxDiffBytes: number
  /** 5xx / 网络错误的重试次数 */
  retries: number
  /** 用于从 git remote 推导 owner/repo 的远端名 */
  defaultRemote: string
  /** User-Agent（GitHub 要求可识别） */
  userAgent: string
}

/** 配置 schema。 */
export const Config: z<Config> = z.object({
  tokenRef: z.string().default('GITHUB_TOKEN').description('凭据引用名；值由 ctx.credentials 解析'),
  baseUrl: z.string().default('https://api.github.com').description('API 基地址（GHE 改成 /api/v3）'),
  timeoutMs: z.number().default(20_000).description('单次请求超时（毫秒）'),
  cacheTtlMs: z.number().default(30_000).description('读缓存 TTL（毫秒）'),
  maxFiles: z.number().default(100).description('PR diff 最多返回的文件数'),
  maxDiffBytes: z.number().default(200_000).description('PR diff 文本上限（字节）'),
  retries: z.number().default(1).description('5xx / 网络错误的重试次数'),
  defaultRemote: z.string().default('origin').description('推导 owner/repo 时优先使用的远端名'),
  userAgent: z.string().default('dsh-git').description('User-Agent'),
})
