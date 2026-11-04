import test from 'node:test'
import assert from 'node:assert/strict'
import { createFnClient, FlowApiError } from '@ketvietlab/flow-client/api.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { validateCustomFields } from '@ketvietlab/flow-client/custom-fields.mjs'
import { isReservedTaskFieldTitle } from '@ketvietlab/flow-client/catalog-contract.mjs'
import {
  atlasFlowCommand,
  prepareFlowCommand,
  resolveFlowCommand,
} from '@ketvietlab/flow-client/command-contract.mjs'
import { createFixtureSession } from '../atlas/store.mjs'
import { flowClientMessages } from '../client/messages.mjs'

test('reserved task field titles normalize Core locales and refusals stay localized', async () => {
  for (const locale of Object.values(flowClientMessages))
    for (const key of ['ui.due.date', 'ui.estimate.points'])
      assert.equal(isReservedTaskFieldTitle(locale[key]), true, key)
  for (const title of [
    'Version',
    ' Phiên   bản ',
    'バージョン',
    'Ｖｅｒｓｉｏｎ',
    'AssigneeIds',
    'Ngày bắt đầu',
  ])
    assert.equal(isReservedTaskFieldTitle(title), true, title)
  for (const title of ['Release version', 'Phiên bản phát hành', 'Deployment note'])
    assert.equal(isReservedTaskFieldTitle(title), false, title)
  try {
    for (const [locale, expected] of [
      ['vi', 'Tên này dành'],
      ['en', 'This name belongs'],
      ['ja', 'この名前は標準'],
    ]) {
      setFlowLocale(locale)
      const client = createFnClient({
        fetch: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              value: {
                ok: false,
                errors: [{ code: 'validation' }],
                fields: { title: 'catalog_reserved_field' },
              },
            }),
          ),
      })
      await assert.rejects(client('flow.field.save', {}), (error) => {
        assert.ok(error instanceof FlowApiError)
        assert.ok(error.fields.title.startsWith(expected))
        return true
      })
    }
  } finally {
    setFlowLocale('vi')
  }
})

test('catalog forms share a typed HTTP vocabulary and retain the Atlas reverse adapter', () => {
  const session = createFixtureSession()
  const form = {
    collection: 'fields',
    title: 'Adapter options',
    description: 'Retained description',
    kind: 'select',
    required: 'false',
    options: 'Production\n Staging \n',
    appliesTo: 'all',
    idempotencyKey: 'catalog-form-adapter',
  }
  const command = resolveFlowCommand(
    'flow.entity.save',
    prepareFlowCommand('flow.entity.save', form, session.data),
  )
  assert.equal(command.name, 'flow.field.save')
  assert.equal(command.input.required, false)
  assert.deepEqual(command.input.options, ['Production', 'Staging'])
  const reverse = atlasFlowCommand(command.name, command.input, session.data)
  assert.equal(reverse.name, 'flow.entity.save')
  assert.equal(reverse.input.required, 'false')
  const created = session.call(reverse.name, reverse.input).value
  assert.ok(created.id, JSON.stringify(created))
  const stored = session.data.fields.find((field) => field.id === created.id)
  assert.equal(stored.description, form.description)
  assert.equal(stored.required, false)
  assert.deepEqual(stored.options, ['Production', 'Staging'])
})

test('native catalog field errors localize without changing fixture errors or trusting prototype keys', async () => {
  try {
    for (const [locale, expected] of [
      ['vi', 'Thay đổi này'],
      ['en', 'This change'],
      ['ja', 'この変更'],
    ]) {
      setFlowLocale(locale)
      const client = createFnClient({
        fetch: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              value: {
                ok: false,
                errors: [{ code: 'validation' }],
                fields: { kind: 'incompatible_values', title: 'Kept text', options: 'constructor' },
              },
            }),
          ),
      })
      await assert.rejects(client('flow.field.save', {}), (error) => {
        assert.ok(error instanceof FlowApiError)
        assert.ok(error.message.startsWith(expected))
        assert.equal(error.fields.kind, error.message)
        assert.equal(error.fields.title, 'Kept text')
        assert.equal(error.fields.options, 'constructor')
        return true
      })
    }
  } finally {
    setFlowLocale('vi')
  }
})

test('text definition changes reject stored nontext scalars, while optional empties remain valid', () => {
  const field = { id: 'answer', title: 'Answer', kind: 'text' }
  for (const value of [false, 0, {}, ['a'], 'a'.repeat(4001)])
    assert.ok(validateCustomFields([field], { answer: value }, 'core'))
  for (const value of [null, '', 'valid'])
    assert.equal(validateCustomFields([field], { answer: value }, 'core'), null)
})
