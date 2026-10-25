import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount } from '@ketvietlab/ketjs-view'
import type { HostNode, IslandMountContext } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]

for (const formPosition of ['ancestor', 'late descendant']) {
  test(`relation picker resets with a ${formPosition} form and disposes its listener`, async () => {
    const globals = globalThis as unknown as Record<string, unknown>
    const previous = {
      Element: globals.Element,
      document: globals.document,
      HTMLSelectElement: globals.HTMLSelectElement,
      HTMLElement: globals.HTMLElement,
      window: globals.window,
      requestAnimationFrame: globals.requestAnimationFrame,
      cancelAnimationFrame: globals.cancelAnimationFrame,
    }
    class ElementFixture extends EventTarget {
      name = 'mentionPartnerIds'
      closest() {
        return formPosition === 'ancestor' ? form : null
      }
      querySelector() {
        return null
      }
      querySelectorAll() {
        return [native]
      }
      contains(node: unknown) {
        return this === form && node === native
      }
    }
    const form = new ElementFixture()
    const native = new ElementFixture()
    const mountRoot = new ElementFixture()
    const reset = () => {
      const event = new Event('reset')
      if (formPosition === 'late descendant') Object.defineProperty(event, 'target', { value: form })
      ;(formPosition === 'ancestor' ? form : mountRoot).dispatchEvent(event)
    }
    globals.Element = ElementFixture
    globals.HTMLSelectElement = ElementFixture
    globals.HTMLElement = ElementFixture
    globals.document = new EventTarget()
    // The picker follows the viewport while it is open.
    globals.window = new EventTarget()
    globals.requestAnimationFrame = () => 0
    globals.cancelAnimationFrame = () => {}
    const controller = createRelationSelectView({
      id: 'mention-reset',
      config: {
        ...relationSelectDemoConfig,
        name: 'mentionPartnerIds',
        manager: undefined,
        multiple: true,
        values: [],
        options: [{ value: 'alice,opaque-id', label: 'Alice' }],
      },
    })
    const host = countingHost(),
      root = host.root(),
      view = mount(host, root, controller.view)
    const lifetime = new AbortController()
    try {
      controller.mount?.({
        root: mountRoot as unknown as IslandMountContext['root'],
        lifetime: lifetime.signal,
      })
      host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
      host.fire(byUi(root, 'relation-option')[0]!, 'click')
      assert.equal(byUi(root, 'relation-chip').length, 1)
      const selected = controller.getSelectedValues()
      assert.deepEqual(selected, ['alice,opaque-id'])
      selected.push('unselected')
      assert.deepEqual(
        controller.getSelectedValues(),
        ['alice,opaque-id'],
        'values are an isolated copy of opaque IDs',
      )
      reset()
      await Promise.resolve()
      assert.equal(byUi(root, 'relation-chip').length, 0)
      assert.deepEqual(controller.getSelectedValues(), [])
      if (!byUi(root, 'relation-option').length) host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
      host.fire(byUi(root, 'relation-option')[0]!, 'click')
      assert.deepEqual(controller.getSelectedValues(), ['alice,opaque-id'])
      lifetime.abort()
      reset()
      await Promise.resolve()
      assert.deepEqual(
        controller.getSelectedValues(),
        ['alice,opaque-id'],
        'an expired mount cannot reset selection',
      )
      controller.dispose?.()
    } finally {
      view.dispose()
      // Work the picker queued before it was disposed runs before the globals go back.
      await new Promise((resolve) => setTimeout(resolve, 0))
      globals.Element = previous.Element
      globals.HTMLElement = previous.HTMLElement
      globals.document = previous.document
      globals.HTMLSelectElement = previous.HTMLSelectElement
      globals.window = previous.window
      globals.requestAnimationFrame = previous.requestAnimationFrame
      globals.cancelAnimationFrame = previous.cancelAnimationFrame
    }
  })
}
