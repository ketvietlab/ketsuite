import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { registerFlowExtension } from '@ketvietlab/flow-client/extensions.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'

function click(node, label) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = click(child, label)
      if (found) return found
    }
    return
  }
  if (node.items && node.render)
    return click(
      node.items.map((item, i) => node.render(item, i)),
      label,
    )
  if (!node.strings) return
  const index = node.strings.findIndex((part) => part.endsWith('on:click='))
  if (index >= 0 && node.strings[0].includes('<button') && renderToStaticString(node).includes(label))
    return node.values[index]
  return click(node.values, label)
}

test('extensions use the core confirmation: cancel makes no write; failed confirmation permits retry', async () => {
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  let context,
    writes = 0,
    complete = false
  registerFlowExtension({
    name: 'confirmation-probe',
    create(ctx) {
      context = ctx
      return {}
    },
  })
  setFlowLocale('en')
  const lifetime = new AbortController(),
    fixture = createOrganizationSession()
  const island = createFlowWorkspace(
    { screen: 'my-work' },
    { call: async (name, args) => fixture.call(name, args).value },
  )
  try {
    island.mount({
      root: Object.assign(new EventTarget(), {
        ownerDocument: new EventTarget(),
        querySelector: () => null,
        querySelectorAll: () => [],
      }),
      lifetime: lifetime.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const request = {
      title: 'Confirm this write',
      message: 'Consequences',
      label: 'Confirm action',
      action: async () => {
        writes++
        return complete
      },
    }
    assert.equal(context.confirmAction(request), true)
    assert.equal(context.confirmAction(request), false, 'do not replace an open question')
    await click(island.view(), 'Cancel')()
    assert.equal(writes, 0)
    assert.doesNotMatch(renderToStaticString(island.view()), /flow-action-confirm/)
    assert.equal(context.confirmAction(request), true)
    await click(island.view(), 'Confirm action')()
    assert.equal(writes, 1)
    assert.match(renderToStaticString(island.view()), /role="alertdialog"/)
    complete = true
    await click(island.view(), 'Confirm action')()
    assert.equal(writes, 2)
    assert.doesNotMatch(renderToStaticString(island.view()), /flow-action-confirm/)
  } finally {
    lifetime.abort()
    island.dispose()
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
  }
})
