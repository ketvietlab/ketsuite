import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileRange, fileSlice } from '../packages/ketsuite/src/modules/flow/native/file-response.ts'
import { flowFilename } from '../packages/ketsuite/src/modules/flow/native/file-policy.ts'

test('native file ranges remain bounded and close the source without buffering the object', async () => {
  assert.deepEqual(fileRange('bytes=-99', 10), { start: 0, end: 9 })
  assert.deepEqual(fileRange('bytes=5-99', 10), { start: 5, end: 9 })
  for (const value of ['bytes=-0', 'bytes=10-', 'bytes=0-1,4-5', 'bytes=9007199254740992-', 'bytes=-'])
    assert.equal(fileRange(value, 10), null, value)
  assert.equal(fileRange('bytes=0-', 0), null)
  let consumed = 0,
    closed = false
  async function* source() {
    try {
      for (let i = 0; i < 10000; i++) {
        consumed++
        yield Buffer.from('abcd')
      }
    } finally {
      closed = true
    }
  }
  const bytes: Uint8Array[] = []
  for await (const chunk of fileSlice(source(), 2, 6)) bytes.push(chunk)
  assert.equal(Buffer.concat(bytes).toString(), 'cdabc')
  assert.equal(consumed, 2)
  assert.equal(closed, true)
})

test('Flow display filenames discard traversal, controls and bidi overrides', () => {
  assert.equal(flowFilename('../../folder\\report\u202e.html\r\n'), 'report.html')
  assert.equal(flowFilename('..\\'), 'upload')
  assert.equal(flowFilename('ＶＮ.txt'), 'VN.txt')
  assert.equal(flowFilename('a'.repeat(500)).length, 255)
  assert.equal(flowFilename('..'), 'upload')
  const unicode = flowFilename('a'.repeat(254) + '😀.txt')
  assert.equal(Array.from(unicode).length, 255)
  assert.ok(unicode.endsWith('😀'))
  assert.doesNotThrow(() => encodeURIComponent(unicode))
})
