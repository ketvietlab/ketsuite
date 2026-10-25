import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { validateHospitalityImage } from '../packages/ketsuite/src/modules/hospitality_core/screens/content-image-validation.ts'

test('Hospitality uploads verify actual raster headers before the trusted route records evidence', async () => {
  const bytes = await sharp({ create: { width: 1024, height: 1200, channels: 3, background: '#aaccee' } })
    .png()
    .toBuffer()
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  let source = bytes
  const ctx = {
    localeOf: () => 'vi',
    translate: () => () => 'Invalid image',
    storageOf: async () => ({
      get: async () => ({
        body: (async function* () {
          yield source
        })(),
      }),
    }),
    callUnchecked: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input })
      return { ok: true }
    },
  } as unknown as ServeContext
  const url = new URL('http://localhost/admin/hospitality/content/upload?property=hotel'),
    req = {} as Parameters<Route>[1]
  const attachment = {
    id: 'photo',
    checksum: 'trusted-upload-checksum',
    storeKey: 'image',
    mimetype: 'image/png',
    size: bytes.byteLength,
  }
  await validateHospitalityImage(ctx, url, req, attachment)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'hospitality_core.recordContentImageEvidence')
  assert.equal(calls[0]!.input.width, 1024)
  assert.equal(calls[0]!.input.height, 1200)
  await assert.rejects(
    validateHospitalityImage(ctx, url, req, { ...attachment, mimetype: 'image/jpeg' }),
    /Invalid image/,
  )
  source = await sharp({ create: { width: 1024, height: 512, channels: 3, background: '#aaccee' } })
    .png()
    .toBuffer()
  await assert.rejects(
    validateHospitalityImage(ctx, url, req, { ...attachment, size: source.byteLength }),
    /Invalid image/,
  )
  source = Buffer.from('<svg width="2048" height="2048"></svg>')
  await assert.rejects(
    validateHospitalityImage(ctx, url, req, { ...attachment, size: source.byteLength }),
    /Invalid image/,
  )
  await assert.rejects(
    validateHospitalityImage(ctx, url, req, { ...attachment, size: 10 * 1024 * 1024 + 1 }),
    /Invalid image/,
  )
  assert.equal(calls.length, 1, 'invalid headers, dimensions or sizes never receive trusted evidence')
})
