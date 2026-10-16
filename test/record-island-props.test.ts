import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordIslandChanges } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

test('record island props: remount retained hosts once without restarting the owning record or unrelated attributes', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class FakeElement {
    isConnected = true
    readonly island: boolean
    constructor(island = true) {
      this.island = island
    }
    matches() {
      return this.island
    }
    querySelector() {
      return null
    }
  }
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement })
  try {
    const root = new FakeElement(),
      field = new FakeElement(),
      added = new FakeElement(),
      removed = new FakeElement(),
      other = new FakeElement(false)
    removed.isConnected = false
    const attribute = (target: FakeElement, attributeName = 'data-props') => ({
      type: 'attributes',
      attributeName,
      target,
      removedNodes: [],
      addedNodes: [],
    })
    const result = recordIslandChanges(
      [
        attribute(field),
        attribute(field),
        attribute(root),
        attribute(other),
        attribute(field, 'class'),
        attribute(removed),
        attribute(added),
        { type: 'childList', target: root, removedNodes: [removed], addedNodes: [added] },
      ] as unknown as MutationRecord[],
      root as unknown as Element,
    )
    assert.deepEqual(result.updated, [field], 'only retained descendant hosts with fresh props restart')
    assert.deepEqual([...result.added], [added])
    assert.deepEqual([...result.removed], [removed])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Element', previous)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})
