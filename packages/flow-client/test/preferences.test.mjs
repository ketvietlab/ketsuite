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

test('personal appearance is isolated by user and Company without importing unowned legacy values', () => {
  const storage = memory([['flow.theme', 'dark']])
  const aliceA = { companyId: 'company-a', userId: 'alice' }
  const aliceB = { companyId: 'company-b', userId: 'alice' }
  const bobA = { companyId: 'company-a', userId: 'bob' }
  assert.deepEqual(readFlowAppearance(storage, aliceA), { theme: 'light', density: 'compact' })
  writeFlowAppearance(storage, 'theme', 'dark', aliceA)
  writeFlowAppearance(storage, 'density', 'comfortable', aliceA)
  assert.deepEqual(readFlowAppearance(storage, bobA), { theme: 'light', density: 'compact' })
  assert.deepEqual(readFlowAppearance(storage, aliceB), { theme: 'light', density: 'compact' })
  assert.deepEqual(readFlowAppearance(storage, aliceA), { theme: 'dark', density: 'comfortable' })
  writeFlowAppearance(storage, 'theme', 'dark', aliceB)
  writeFlowAppearance(storage, 'density', 'comfortable', bobA)
  assert.deepEqual(readFlowAppearance(storage, bobA), { theme: 'light', density: 'comfortable' })
  assert.deepEqual(readFlowAppearance(storage, aliceB), { theme: 'dark', density: 'compact' })
})

test('pending identity uses safe appearance defaults and cannot overwrite another identity', () => {
  const storage = memory([['flow.theme', 'dark']])
  const pending = { companyId: 'company-a', userId: '' }
  assert.deepEqual(readFlowAppearance(storage, pending), { theme: 'light', density: 'compact' })
  assert.equal(writeFlowAppearance(storage, 'theme', 'light', pending), true)
  assert.equal(storage.getItem('flow.theme'), 'dark')
  assert.deepEqual(readFlowAppearance(storage, { companyId: 'a:b', userId: 'c' }), {
    theme: 'light',
    density: 'compact',
  })
  writeFlowAppearance(storage, 'theme', 'dark', { companyId: 'a:b', userId: 'c' })
  assert.equal(readFlowAppearance(storage, { companyId: 'a', userId: 'b:c' }).theme, 'light')
})
