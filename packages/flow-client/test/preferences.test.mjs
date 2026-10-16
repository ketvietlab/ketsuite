import assert from 'node:assert/strict'
import test from 'node:test'
import { readFlowAppearance, writeFlowAppearance } from '../client/preferences.mjs'

const memory = (initial = []) => {
  const values = new Map(initial)
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('appearance restores both preferences after recreating the workspace', () => {
  const storage = memory()
  assert.equal(writeFlowAppearance(storage, 'theme', 'dark'), true)
  assert.equal(writeFlowAppearance(storage, 'density', 'comfortable'), true)
  assert.deepEqual(readFlowAppearance(storage), { theme: 'dark', density: 'comfortable' })
})

test('unknown and corrupt appearance values fall back without accepting arbitrary settings', () => {
  const storage = memory([
    ['flow.theme', 'invalid'],
    ['flow.density', 'dense'],
  ])
  assert.deepEqual(readFlowAppearance(storage), { theme: 'light', density: 'compact' })
  assert.equal(writeFlowAppearance(storage, 'theme', 'invalid'), false)
  assert.equal(writeFlowAppearance(storage, '__proto__', 'dark'), false)
  assert.equal(writeFlowAppearance(storage, 'tenant', 'other'), false)
})

test('blocked storage preserves functional local preferences and safe defaults', () => {
  const storage = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('full')
    },
  }
  assert.deepEqual(readFlowAppearance(storage), { theme: 'light', density: 'compact' })
  assert.equal(writeFlowAppearance(storage, 'theme', 'dark'), true)
  assert.deepEqual(readFlowAppearance(undefined), { theme: 'light', density: 'compact' })
})
