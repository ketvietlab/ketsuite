import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFileUploader } from '../dist/api.mjs'
import { setFlowLocale, tr } from '../dist/i18n.mjs'

test('upload quota refusal has a recoverable message in every Core locale', async () => {
  for (const locale of ['vi', 'en', 'ja']) {
    setFlowLocale(locale)
    const upload = createFileUploader({
      fetch: async () => Response.json({ ok: false, code: 'upload_quota' }, { status: 413 }),
    })
    await assert.rejects(
      upload(new File(['x'], 'file.txt'), { projectId: 'p' }),
      (error) => error.code === 'upload_quota' && error.message === tr('flow.validation.uploadQuota'),
    )
  }
  setFlowLocale('vi')
})

test('declared oversized requests explain the file limit before retrying', async () => {
  const upload = createFileUploader({
    fetch: async () =>
      Response.json({ ok: false, code: 'upload_size', limitBytes: 25 * 1024 * 1024 }, { status: 413 }),
  })
  await assert.rejects(
    upload(new File(['x'], 'large.bin'), { projectId: 'p' }),
    (error) =>
      error.code === 'upload_size' && error.message === tr('flow.ui.file.too.large', ['large.bin', 25]),
  )
})

test('file uploads retain access refusals even when the response is not JSON', async () => {
  for (const [status, code] of [
    [401, 'unauthenticated'],
    [403, 'forbidden'],
  ]) {
    const upload = createFileUploader({ fetch: async () => new Response('Forbidden', { status }) })
    await assert.rejects(
      upload(new File(['x'], 'file.txt'), { projectId: 'p' }),
      (error) =>
        error.code === code &&
        error.message === tr(status === 401 ? 'flow.ui.session.expired' : 'flow.ui.access.denied'),
    )
  }
})
