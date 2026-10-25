import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import type { IncomingMessage } from 'node:http'
import { raw, withHeaders } from '@ketvietlab/ketjs'
import { compressFlowDocument } from '../packages/ketsuite/src/modules/flow_workspace/compression.ts'

test('Flow document compression preserves status, content and navigation variation', () => {
  const body = '<main>Vietnamese 日本語</main>'.repeat(100)
  const response = withHeaders(raw(body, { type: 'text/html', status: 403 }), {
    vary: 'X-Ket-Navigation',
    'cache-control': 'no-store',
  })
  for (const [accept, encoding] of [
    ['br, gzip', 'br'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=.2, gzip;q=.9', 'gzip'],
  ]) {
    const req = { headers: { 'accept-encoding': accept } } as IncomingMessage
    const result = compressFlowDocument(req, response)
    assert.equal(result.status, 403)
    assert.equal(result.headers?.['content-encoding'], encoding)
    assert.equal(result.headers?.vary, 'X-Ket-Navigation, Accept-Encoding')
    const bytes = result.body as Uint8Array
    assert.equal((encoding === 'br' ? brotliDecompressSync(bytes) : gunzipSync(bytes)).toString(), body)
    assert.equal(Number(result.headers?.['content-length']), bytes.byteLength)
    assert.ok(bytes.byteLength < Buffer.byteLength(body))
  }
  assert.equal(
    compressFlowDocument({ headers: { 'accept-encoding': 'br;q=0,gzip;q=0' } } as IncomingMessage, response),
    response,
  )
})
