/**
 * 面板 RPC 的 HTTP 适配层：把 `ctx.webServer` 的裸 node:http 请求翻译成 op 调用。
 *
 * 只做四件事：方法校验、路径 → op、读取并限制请求体、统一 JSON 响应。
 * 业务全部在 `ops.ts` 里，因此这里可以很薄。
 *
 * @module dsh-git-client/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isOpName, runOp, toErrorResponse, type OpRequest } from './ops.js'

/** 路由默认路径（不含尾斜杠）。 */
export const DEFAULT_RPC_PATH = '/api/dsh-git'

/** 请求体上限：面板只传小 JSON，64 KiB 足够，超了直接 413。 */
export const MAX_BODY_BYTES = 64 * 1024

/** 路由依赖。 */
export interface RouteDeps {
  ctx: Context
  maxCommits: number
}

/**
 * 从 URL 里取出 op。
 *
 * @param pathname - 请求路径
 * @param basePath - 路由前缀
 * @returns op 名；不在前缀下返回 null
 */
export function parseOp(pathname: string, basePath: string = DEFAULT_RPC_PATH): string | null {
  const normalized = pathname.replace(/\/+$/, '')
  if (!normalized.startsWith(basePath)) return null
  const rest = normalized.slice(basePath.length).replace(/^\/+/, '')
  return rest === '' ? null : rest
}

/**
 * 读取并解析 JSON 请求体。
 *
 * @param req - 请求
 * @param limit - 字节上限
 * @returns 解析结果；空体返回空对象
 * @throws Error 体过大或不是合法 JSON
 */
export async function readJsonBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error(`请求体超过 ${limit} 字节`)
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw === '') return {}
  return JSON.parse(raw) as unknown
}

/** 写一个 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

/**
 * 构造路由处理器。
 *
 * @param deps - 上下文与配置
 * @returns node:http 处理器
 */
export function createRouteHandler(deps: RouteDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只接受 POST' } })
        return
      }

      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const op = parseOp(pathname)
      if (op === null || !isOpName(op)) {
        sendJson(res, 404, {
          ok: false,
          error: {
            code: 'unknown-op',
            message: `未知的 op：${op ?? '(空)'}`,
            hint: '可用 op：snapshot / branches / worktrees / pr（写操作请走模型工具）',
          },
        })
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'invalid-body', message: error instanceof Error ? error.message : '无法解析请求体' },
        })
        return
      }

      const data = await runOp(deps.ctx, op, body as OpRequest, deps.maxCommits)
      sendJson(res, 200, { ok: true, data })
    } catch (error) {
      const mapped = toErrorResponse(error)
      sendJson(res, mapped.status, mapped.body)
    }
  }
}
