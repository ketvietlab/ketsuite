import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFnClient, selectFlowCompany } from '../dist/api.mjs'
import { setFlowLocale, tr } from '../dist/i18n.mjs'

test('native validation codes produce localized field and form recovery messages', async () => {
  for (const locale of ['vi', 'en', 'ja']) {
    setFlowLocale(locale)
    const call = createFnClient({
      fetch: async () =>
        Response.json({
          ok: true,
          value: {
            ok: false,
            errors: [{ code: 'validation' }],
            fields: { title: 'required', end: 'invalid', code: 'duplicate' },
          },
        }),
    })
    await assert.rejects(
      call('flow.project.save', {}),
      (error) =>
        error.fields.title === tr('flow.validation.required') &&
        error.fields.end === tr('flow.validation.invalid') &&
        error.fields.code === tr('flow.validation.duplicate') &&
        error.message === error.fields.title,
    )
  }
  setFlowLocale('vi')
})

test('framework access refusals normalize before reading JSON so retained private data can be cleared', async () => {
  for (const [status, code, body] of [
    [401, 'unauthenticated', 'Unauthorized'],
    [403, 'forbidden', JSON.stringify({ code: 'E_FUNCTION_DENIED', message: 'flow.workspace.bootstrap' })],
  ]) {
    const call = createFnClient({ fetch: async () => new Response(body, { status }) })
    await assert.rejects(
      call('flow.workspace.bootstrap'),
      (error) => error.code === code && !error.message.includes('flow.workspace.bootstrap'),
    )
  }
})

test('Company selection sends the source session context and normalizes refusals', async () => {
  let request
  await selectFlowCompany('b', 'a', {
    fetch: async (url, options) => {
      request = { url, options }
      return Response.json({ ok: true })
    },
  })
  assert.equal(request.url, '/flow/context')
  assert.equal(request.options.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(request.options.body), { companyId: 'b', fromCompany: 'a' })
  for (const [status, code] of [
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [409, 'conflict'],
  ])
    await assert.rejects(
      selectFlowCompany('b', 'a', { fetch: async () => new Response('', { status }) }),
      (error) => error.code === code,
    )
})
