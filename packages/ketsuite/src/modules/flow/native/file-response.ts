import { streamed, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { inlineTypes } from '../../storage/policy.ts'

export function fileRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || !size || (!match[1] && !match[2])) return null
  const first = match[1] ? Number(match[1]) : null,
    last = match[2] ? Number(match[2]) : null
  if ([first, last].some((n) => n !== null && !Number.isSafeInteger(n))) return null
  const start = first ?? Math.max(0, size - (last ?? 0)),
    end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
  return start >= size || start > end ? null : { start, end }
}

/** Storage's current contract has no ranged get. Skip/yield incrementally and
 * close the source at the requested end; never buffer the complete object. */
export async function* fileSlice(body: AsyncIterable<Uint8Array>, start: number, end: number) {
  let offset = 0
  for await (const chunk of body) {
    const next = offset + chunk.byteLength
    if (next > start)
      yield chunk.subarray(Math.max(0, start - offset), Math.min(chunk.length, end + 1 - offset))
    offset = next
    if (offset > end) return
  }
}

/** The route authorizes the native owner before handing this helper a record. */
export async function flowFileResponse(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  attachment: Row,
) {
  const storage = await ctx.storageOf(url, req),
    key = String(attachment.storeKey)
  const meta = await storage.head(key)
  if (!meta) return text('Not found', { status: 404 })
  const inline = inlineTypes.has(String(attachment.mimetype)),
    etag = '"' + attachment.checksum + '"'
  const headers: Record<string, string> = {
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'accept-ranges': 'bytes',
    etag,
    'content-disposition':
      (inline ? 'inline' : 'attachment') +
      "; filename*=UTF-8''" +
      encodeURIComponent(String(attachment.name)).replace(
        /['()*]/g,
        (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
      ),
    'content-length': String(meta.size),
  }
  const type = inline ? String(attachment.mimetype) : 'application/octet-stream'
  if (req.method === 'HEAD') return withHeaders(text('', { type }), headers)
  const requested = req.headers.range,
    range =
      requested && (!req.headers['if-range'] || req.headers['if-range'] === etag)
        ? fileRange(String(requested), meta.size)
        : undefined
  if (range === null)
    return withHeaders(text('', { status: 416 }), {
      ...headers,
      'content-length': '0',
      'content-range': `bytes */${meta.size}`,
    })
  const stored = await storage.get(key)
  if (!stored) return text('Not found', { status: 404 })
  return withHeaders(
    streamed(range ? fileSlice(stored.body, range.start, range.end) : stored.body, {
      type,
      status: range ? 206 : 200,
    }),
    range
      ? {
          ...headers,
          'content-length': String(range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${meta.size}`,
        }
      : headers,
  )
}
