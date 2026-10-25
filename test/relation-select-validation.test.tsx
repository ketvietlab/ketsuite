import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { countingHost, mount } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const find = (node: HostNode, ui: string): HostNode | undefined =>
  node.attrs?.['data-ui'] === ui ? node : (node.children ?? []).map((child) => find(child, ui)).find(Boolean)
const render = (extra = {}) => {
  const controller = createRelationSelectView({
    id: 'validation-picker',
    config: { ...relationSelectDemoConfig, name: 'qualityLocationId', required: true, ...extra },
  })
  const host = countingHost()
  const root = host.root()
  const mounted = mount(host, root, controller.view)
  const result = { native: find(root, 'relation-native')!, trigger: find(root, 'relation-trigger')! }
  mounted.dispose()
  controller.dispose?.()
  return result
}
test('relation validation: public trigger owns the field label/error association and remains the visible error focus target', () => {
  const { native, trigger } = render({
    triggerId: 'quality-location',
    invalid: true,
    describedBy: 'quality-location-error',
  })
  assert.equal(trigger.attrs?.id, 'quality-location')
  assert.equal(trigger.attrs?.['aria-invalid'], 'true')
  assert.equal(trigger.attrs?.['aria-describedby'], 'quality-location-error')
  assert.notEqual(trigger.attrs?.disabled, true)
  assert.equal(native.attrs?.name, 'qualityLocationId')
  assert.equal(native.attrs?.['aria-hidden'], 'true')
  assert.ok(!native.attrs?.['aria-invalid'])
})
test('relation validation: legacy config and a cleared error add no invalid/described-by state or trigger ID', () => {
  for (const extra of [{}, { invalid: false, describedBy: null }]) {
    const { trigger } = render(extra)
    assert.ok(!trigger.attrs?.id)
    assert.ok(!trigger.attrs?.['aria-invalid'])
    assert.ok(!trigger.attrs?.['aria-describedby'])
  }
})
test('relation validation: a disabled picker disables its trigger and is styled as a disabled field control', () => {
  const { trigger } = render({ disabled: true })
  assert.equal(String(trigger.attrs?.disabled), 'true')
  const css = readFileSync('packages/design-system/src/interactions/relation-select/styles.css', 'utf8')
  const rule = /\[data-ui="relation-trigger"\]:disabled \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  for (const token of ['--kv-panel-border', '--kv-interactive-disabled', '--kv-text-disabled'])
    assert.match(rule, new RegExp(`var\\(${token}\\)`, 'u'))
  assert.match(rule, /cursor: not-allowed/u)
})
