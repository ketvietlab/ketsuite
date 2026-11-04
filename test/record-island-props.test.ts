import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordIslandChanges, recordIslandKey } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

test('record island props: remount retained hosts once without restarting the owning record or unrelated attributes', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class FakeElement {
    isConnected = true
    readonly island: boolean
    constructor(island = true) {
      this.island = island
    }
    getAttribute(_name: string) {
      return null
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

test('record grid islands retain their own reflected draft but refresh actual configuration changes', () => {
  const props = {
    id: 'lines',
    config: { name: 'lines', carry: '{}', readOnly: false, rows: [{ id: 'one' }] },
  }
  assert.equal(
    recordIslandKey('backend.ket-grid', props),
    recordIslandKey('backend.ket-grid', { ...props, config: { ...props.config, carry: '{"updated":[]}' } }),
  )
  assert.notEqual(
    recordIslandKey('backend.ket-grid', props),
    recordIslandKey('backend.ket-grid', { ...props, config: { ...props.config, readOnly: true } }),
  )
  assert.notEqual(
    recordIslandKey('backend.ket-grid', props),
    recordIslandKey('backend.ket-grid', { ...props, config: { ...props.config, rows: [] } }),
  )
  assert.notEqual(
    recordIslandKey('other.island', props),
    recordIslandKey('other.island', { ...props, config: { ...props.config, carry: 'new' } }),
  )
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class Host {
    isConnected = true
    props = JSON.stringify(props)
    value = '{}'
    matches() {
      return true
    }
    getAttribute(name: string) {
      return name === 'data-island' ? 'backend.ket-grid' : this.props
    }
    querySelector() {
      return { value: this.value }
    }
  }
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: Host })
  try {
    const root = new Host(),
      host = new Host()
    const mutation = [
      { type: 'attributes', attributeName: 'data-props', target: host, addedNodes: [], removedNodes: [] },
    ] as unknown as MutationRecord[]
    assert.deepEqual(recordIslandChanges(mutation, root as unknown as Element).updated, [])
    host.props = JSON.stringify({ ...props, config: { ...props.config, carry: 'reset from parent' } })
    assert.deepEqual(recordIslandChanges(mutation, root as unknown as Element).updated, [host])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Element', previous)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})
