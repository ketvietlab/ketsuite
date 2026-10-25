import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { withHeaders } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { RouteResult } from '@ketvietlab/ketjs'

/** Compress rendered documents/fragments; rendering stays synchronous and canonical. */
export function compressFlowDocument(req: IncomingMessage, response: RouteResult): RouteResult {
  if (
    response.headers?.['content-encoding'] ||
    (typeof response.body !== 'string' && !(response.body instanceof Uint8Array))
  )
    return response
  const body = Buffer.from(response.body)
  if (body.length < 1024) return response
  const weights = new Map<string, number>()
  for (const entry of String(req.headers['accept-encoding'] ?? '').split(',')) {
    const [name, ...params] = entry.trim().toLowerCase().split(';')
    if (!name) continue
    const quality = params
      .find((p) => p.trim().startsWith('q='))
      ?.trim()
      .slice(2)
    const value = quality === undefined ? 1 : Number(quality)
    weights.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0)
  }
  const quality = (name: string) => weights.get(name) ?? weights.get('*') ?? 0
  const br = quality('br'),
    gzip = quality('gzip')
  const encoding = br > 0 && br >= gzip ? 'br' : gzip > 0 ? 'gzip' : null
  if (!encoding) return response
  const compressed =
    encoding === 'br'
      ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
      : gzipSync(body)
  const vary = [
    ...new Set([
      ...(response.headers?.vary ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      'Accept-Encoding',
    ]),
  ].join(', ')
  return withHeaders(
    { ...response, body: compressed },
    {
      'content-encoding': encoding,
      'content-length': String(compressed.length),
      vary,
    },
  )
}
