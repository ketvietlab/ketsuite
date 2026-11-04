import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount, renderToStaticString } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { createRelationSelectView, Disclosure } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')

const values = [
  { value: '30ml', label: '30ml' },
  { value: '50ml', label: '50ml' },
  { value: '100ml', label: '100ml' },
  { value: '200ml', label: '200ml' },
]

// The browser's own constructors, as far as the picker reads them.
const withDom = (run: (keydown: (key: string) => unknown) => void): void => {
  class Input {
    value = ''
  }
  class KeyboardEvent {
    key = ''
    defaultPrevented = false
    preventDefault() {
      this.defaultPrevented = true
    }
    stopPropagation() {}
  }
  const globals = globalThis as unknown as Record<string, unknown>
  const previous = { HTMLInputElement: globals.HTMLInputElement, KeyboardEvent: globals.KeyboardEvent }
  globals.HTMLInputElement = Input
  globals.KeyboardEvent = KeyboardEvent
  try {
    run((key) => Object.assign(new KeyboardEvent(), { key }))
  } finally {
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete globals[name]
      else globals[name] = value
  }
}

test('relation select tags: chips sit inside the control before a combobox input, chosen records leave the list', () => {
  withDom((keydown) => {
    const controller = createRelationSelectView({
      id: 'volume',
      config: {
        ...relationSelectDemoConfig,
        name: 'values[volume]',
        triggerId: 'product-volume',
        multiple: true,
        presentation: 'tags',
        values: ['100ml'],
        options: values,
        labels: { ...relationSelectDemoConfig.labels, createNamed: 'Create “{query}”' },
      },
    })
    const host = countingHost()
    const root = host.root()
    const view = mount(host, root, controller.view)
    try {
      const control = byUi(root, 'relation-control')[0]!
      const input = byUi(control, 'relation-input')[0]!
      assert.equal(byUi(control, 'relation-chip').length, 1, 'the chip is inside the control')
      assert.equal(input.attrs?.role, 'combobox')
      assert.equal(input.attrs?.id, 'product-volume', 'the Field label names the input')
      assert.equal(byUi(root, 'relation-trigger').length, 0, 'no separate trigger button')
      // Arrow down opens the list without what is chosen; the first match is the active one.
      host.fire(input, 'keydown', keydown('ArrowDown'))
      assert.deepEqual(byUi(root, 'relation-option').map(textOf), ['30ml', '50ml', '200ml'])
      host.fire(byUi(root, 'relation-input')[0]!, 'keydown', keydown('ArrowDown'))
      const active = byUi(root, 'relation-option').find((node) => node.attrs?.['data-active'] === 'true')!
      assert.equal(textOf(active), '50ml')
      assert.equal(byUi(root, 'relation-input')[0]!.attrs?.['aria-activedescendant'], active.attrs?.id)
      // Enter picks it, never submitting the form, and closes the list.
      const enter = keydown('Enter') as { defaultPrevented: boolean }
      host.fire(byUi(root, 'relation-input')[0]!, 'keydown', enter)
      assert.equal(enter.defaultPrevented, true)
      assert.deepEqual(controller.getSelectedValues(), ['100ml', '50ml'])
      assert.equal(byUi(root, 'relation-menu').length, 0)
      // The native select posts the choices joined, as a multiple picker does.
      const native = byUi(root, 'relation-native')[0]!
      assert.ok(textOf(native).includes('100ml, 50ml'))
      // Backspace in an empty input takes the last chip off; the clear button takes them all.
      host.fire(byUi(root, 'relation-input')[0]!, 'keydown', keydown('Backspace'))
      assert.deepEqual(controller.getSelectedValues(), ['100ml'])
      host.fire(byUi(root, 'relation-clear-all')[0]!, 'click')
      assert.deepEqual(controller.getSelectedValues(), [])
      assert.equal(byUi(root, 'relation-clear-all').length, 0)
    } finally {
      view.dispose()
      controller.dispose?.()
    }
  })
})

test('relation select tags: typing filters and offers to create the typed name in the manager dialog', () => {
  withDom((keydown) => {
    const controller = createRelationSelectView({
      id: 'volume',
      config: {
        ...relationSelectDemoConfig,
        name: 'values[volume]',
        multiple: true,
        presentation: 'tags',
        values: [],
        options: values,
        labels: {
          ...relationSelectDemoConfig.labels,
          createTitle: 'Create value',
          createNamed: 'Create “{query}”',
        },
        manager: {
          listFunction: 'catalogue.attributeValues',
          listInput: { attributeId: 'volume' },
          saveFunction: 'catalogue.createAttributeValue',
          saveDefaults: { attributeId: 'volume' },
          fields: [{ name: 'name', label: 'Value name', required: true }],
        },
      },
    })
    const host = countingHost()
    const root = host.root()
    const view = mount(host, root, controller.view)
    try {
      const typed = new (
        globalThis as unknown as { HTMLInputElement: new () => { value: string } }
      ).HTMLInputElement()
      typed.value = '500ml'
      host.fire(byUi(root, 'relation-input')[0]!, 'input', { currentTarget: typed })
      assert.equal(byUi(root, 'relation-option').length, 0)
      const footer = byUi(root, 'relation-footer')[0]!
      assert.match(textOf(footer), /Create “500ml”/)
      // Enter with no match creates: the dialog opens on the editor alone, its name filled in.
      host.fire(byUi(root, 'relation-input')[0]!, 'keydown', keydown('Enter'))
      const sheet = byUi(root, 'modal-sheet')[0]!
      assert.equal(sheet.attrs?.['data-size'], 'small')
      assert.equal(textOf(byUi(root, 'modal-title')[0]!), 'Create value')
      assert.equal(byUi(root, 'relation-dialog-toolbar').length, 0, 'no browsing while creating one')
      const editor = byUi(root, 'relation-editor')[0]!
      assert.equal(editor.attrs?.['data-presentation'], 'plain')
      const name = byUi(editor, 'field-control').find((node) => node.attrs?.name === 'name')
      assert.equal(name?.attrs?.value, '500ml')
      // Its actions are the dialog's; Cancel closes it.
      const actions = byUi(root, 'modal-actions')[0]!
      host.fire(
        byUi(actions, 'action').find((node) => textOf(node) === relationSelectDemoConfig.labels.cancel)!,
        'click',
      )
      assert.equal(byUi(root, 'modal-sheet').length, 0)
    } finally {
      view.dispose()
      controller.dispose?.()
    }
  })
})

test('disclosure: a leading image starts the line before its label; without one the markup is unchanged', () => {
  const plain = renderToStaticString(Disclosure({ summary: 'Line', body: 'Body' }))
  assert.match(plain, /<summary data-ui="disclosure-summary">Line<\/summary>/)
  const led = renderToStaticString(
    Disclosure({ summary: '100ml', leading: <img alt="" src="/a.png" />, meta: 'XP-01A', body: 'Body' }),
  )
  assert.match(
    led,
    /<span data-ui="disclosure-leading"><img[^>]*><\/span><span data-ui="disclosure-label">100ml<\/span><span data-ui="disclosure-meta">XP-01A<\/span>/,
  )
})
