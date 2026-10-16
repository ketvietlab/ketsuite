import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { installRecordRefresh } from '../packages/ketsuite/src/ui/client/table-selection-view.tsx'

// The backend shell refreshes the collection behind a record modal after a save
// (ui/client/table-selection-view.tsx), unless the collection is an island that reads
// itself again and says so by cancelling `ket:records-changed`.

const shell = (t: TestContext) => {
  const doc = Object.assign(new EventTarget(), { querySelector: () => ({}) })
  const previous = ['document', 'location'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'http://ket.local/admin/product/uoms?record=product.uom%3Anew' },
  })
  const lifetime = new AbortController()
  t.after(() => {
    lifetime.abort()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const fetched: string[] = []
  installRecordRefresh(lifetime.signal, {
    navigate: async (href: string) => {
      fetched.push(href)
    },
  } as never)
  const announce = (detail: Record<string, unknown> = { kind: 'product.uom', ids: ['u1'] }) =>
    doc.dispatchEvent(new CustomEvent('ket:records-changed', { cancelable: true, detail }))
  return { doc, fetched, announce }
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

test('record refresh: the shell re-fetches the page behind a saved record', async (t) => {
  const { fetched, announce } = shell(t)
  announce()
  assert.deepEqual(fetched, [], 'it waits for every listener first')
  await settled()
  assert.deepEqual(fetched, ['http://ket.local/admin/product/uoms?record=product.uom%3Anew'])
  announce({ kind: 'product.template', ids: ['t1'], page: true })
  await settled()
  assert.equal(fetched.length, 1, 'a record page has no collection behind it')
})

test('record refresh: a collection island that reads itself again leaves the page alone', async (t) => {
  const { doc, fetched, announce } = shell(t)
  // The island listens after the shell, as one mounted by a later navigation does.
  doc.addEventListener('ket:records-changed', (event) => event.preventDefault())
  assert.equal(announce(), false)
  await settled()
  assert.deepEqual(fetched, [])
})
