import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createTaskExchange } from '../dist/task-exchange.mjs'
import { encodeExchange } from '../dist/exchange-contract.mjs'
import { setFlowLocale } from '../dist/i18n.mjs'
setFlowLocale('en')

const handler = (node, marker, event) => {
  if (!node || typeof node !== 'object') return null
  const children = Array.isArray(node)
    ? node
    : node.items && node.render
      ? node.items.map((item, index) => node.render(item, index))
      : (node.values ?? [])
  if (node.strings && (node.values.includes(marker) || node.strings.some((s) => s.includes(marker)))) {
    const index = node.strings.findIndex((s) => s.endsWith(`on:${event}=`))
    if (index >= 0 && typeof node.values[index] === 'function') return node.values[index]
  }
  for (const child of children) {
    const found = handler(child, marker, event)
    if (found) return found
  }
  return null
}
function fixture(
  behavior,
  previewResult = (input, number) => ({
    valid: true,
    previewDigest: 'preview-' + number,
    rows: input.rows.map((row) => ({ sourceId: row.sourceId, ok: true })),
  }),
) {
  let accepted = 0,
    previews = 0
  const applied = []
  const controller = createTaskExchange({
    project: () => 'project',
    data: () => ({ columns: [], taskTypes: [], tags: [], members: [], fields: [] }),
    canWrite: () => true,
    call: async (_name, input) => {
      previews++
      return previewResult(input, previews)
    },
    apply: async (input, success, failure) => {
      applied.push(structuredClone(input))
      return behavior(input, success, failure, applied.length)
    },
    acceptDraft: () => accepted++,
  })
  const click = async (label) => {
    const fn = handler(controller.view(), label, 'click')
    assert.equal(typeof fn, 'function', label)
    await fn()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const input = (rows) =>
    handler(controller.view(), 'flow-exchange-text', 'input')({ target: { value: encodeExchange(rows) } })
  const preview = async () => {
    handler(controller.view(), '<form', 'submit')({ preventDefault() {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return {
    controller,
    click,
    input,
    preview,
    applied,
    get accepted() {
      return accepted
    },
    get previews() {
      return previews
    },
  }
}

test('uncertain exchange retries preserve the exact accepted intent and dismiss the draft only after acknowledgement', async () => {
  const f = fixture((input, success, _failure, attempt) => {
    if (attempt === 1) return false
    success({ imported: input.rows.length })
    return true
  })
  try {
    f.input([{ sourceId: 'one', title: 'Retry this task' }])
    await f.preview()
    await f.click('Apply import')
    assert.equal(f.accepted, 0)
    const previews = f.previews
    await f.click('Retry')
    assert.deepEqual(f.applied[1], f.applied[0], 'same replay key, rows, mapping and digest')
    assert.equal(f.previews, previews, 'an uncertain retry must not replace its digest')
    assert.equal(f.accepted, 1)
    await f.click('New import')
    assert.doesNotMatch(renderToStaticString(f.controller.view()), /Retry this task/)
  } finally {
    f.controller.dispose()
  }
})

test('partial exchange failure reviews only the remaining records while retaining import identity', async () => {
  const f = fixture((input, success, failure, attempt) => {
    if (attempt === 2) {
      failure({ code: 'validation' })
      return false
    }
    success({ imported: input.rows.length })
    return true
  })
  try {
    f.input(Array.from({ length: 101 }, (_, i) => ({ sourceId: 'row-' + i, title: 'Task ' + i })))
    await f.preview()
    await f.click('Apply import')
    assert.equal(f.applied.length, 2)
    assert.equal(f.accepted, 0)
    await f.click('Review remaining records')
    const remaining = renderToStaticString(f.controller.view())
    assert.match(remaining, /row-100/)
    assert.doesNotMatch(remaining, /row-99/)
    await f.preview()
    await f.click('Apply import')
    assert.equal(f.applied[2].rows.length, 1)
    assert.equal(f.applied[2].rows[0].sourceId, 'row-100')
    assert.equal(f.applied[2].importId, f.applied[0].importId)
    assert.notEqual(f.applied[2].idempotencyKey, f.applied[0].idempotencyKey)
    assert.equal(f.accepted, 1)
  } finally {
    f.controller.dispose()
  }
})

test('mapping controls page source IDs without rendering a control for every imported record', async () => {
  const f = fixture(() => false)
  try {
    f.input(
      Array.from({ length: 1000 }, (_, i) => ({
        sourceId: 'row-' + i,
        title: 'Task ' + i,
        columnId: 'column-' + i,
      })),
    )
    await f.preview()
    assert.equal(f.previews, 10, 'all ten batches reach preview')
    let output = renderToStaticString(f.controller.view())
    assert.equal((output.match(/id="flow-exchange-columns-/g) ?? []).length, 10)
    assert.doesNotMatch(output, /\[object Object\]/)
    await f.click('Next mappings')
    output = renderToStaticString(f.controller.view())
    assert.equal((output.match(/id="flow-exchange-columns-/g) ?? []).length, 10)
    assert.match(output, /column-10/)
    assert.doesNotMatch(output, /value="column-0"/)
  } finally {
    f.controller.dispose()
  }
})

test('invalid preview records render accessible feedback instead of raw template objects', async () => {
  const f = fixture(
    () => false,
    (input) => ({
      valid: false,
      rows: input.rows.map((row) => ({
        sourceId: row.sourceId,
        ok: false,
        code: 'validation',
        fields: { title: 'required' },
      })),
    }),
  )
  try {
    f.input([{ sourceId: 'bad-record', title: '' }])
    await f.preview()
    const output = renderToStaticString(f.controller.view())
    assert.match(output, /role="alert"/)
    assert.match(output, /bad-record/)
    assert.doesNotMatch(output, /\[object Object\]/)
    assert.equal(handler(f.controller.view(), 'Apply import', 'click'), null)
  } finally {
    f.controller.dispose()
  }
})

test('discarding an exchange draft cancels a late preview and clears its retained file intent', async () => {
  const pending = Promise.withResolvers()
  const f = fixture(
    () => false,
    () => pending.promise,
  )
  try {
    f.input([{ sourceId: 'old-draft', title: 'Discarded task' }])
    await f.preview()
    f.controller.discard()
    pending.resolve({ valid: true, previewDigest: 'late', rows: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const output = renderToStaticString(f.controller.view())
    assert.doesNotMatch(output, /old-draft|Discarded task/)
    assert.equal(handler(f.controller.view(), 'Apply import', 'click'), null)
    assert.equal(f.accepted, 0)
  } finally {
    f.controller.dispose()
  }
})
