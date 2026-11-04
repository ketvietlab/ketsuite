import test from 'node:test'
import assert from 'node:assert/strict'
import { createFnClient, FlowApiError } from '@ketvietlab/flow-client/api.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'

test('native snapshot overwrite refusals explain the collaborative editor in every Core locale', async () => {
  try {
    for (const [locale, expected] of [
      ['vi', 'trình soạn thảo cộng tác'],
      ['en', 'collaborative editor'],
      ['ja', '共同編集エディター'],
    ]) {
      setFlowLocale(locale)
      const call = createFnClient({
        fetch: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              value: {
                ok: false,
                errors: [{ code: 'validation' }],
                fields: { description: 'live_document_required' },
              },
            }),
          ),
      })
      await assert.rejects(call('flow.project.save', {}), (error) => {
        assert.ok(error instanceof FlowApiError)
        assert.equal(error.code, 'validation')
        assert.ok(error.fields.description.includes(expected))
        assert.ok(!error.message.includes('live_document_required'))
        return true
      })
    }
  } finally {
    setFlowLocale('vi')
  }
})
