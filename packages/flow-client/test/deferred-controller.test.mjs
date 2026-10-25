import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeferredController } from '../client/deferred-controller.mjs'

test('route controllers load once on demand, retry and ignore reset/disposed reads', async () => {
  let resolve,
    reject,
    loads = 0,
    creations = 0,
    resets = 0
  const controller = createDeferredController({
    load: () => {
      loads++
      return new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
    },
    loading: () => 'loading',
    failed: () => 'error',
  })
  const factory = () => {
    creations++
    return { view: () => 'view', modal: () => ({ body: 'form' }), reset: () => resets++ }
  }
  assert.equal(controller.view(), 'loading')
  assert.equal(loads, 0)
  let p = controller.prepare()
  assert.equal(controller.prepare(), p)
  await Promise.resolve()
  reject(new Error('offline'))
  await p
  assert.equal(controller.view(), 'error')
  p = controller.prepare()
  await Promise.resolve()
  controller.reset()
  resolve(factory)
  await p
  assert.equal(creations, 0)
  p = controller.prepare()
  await Promise.resolve()
  resolve(factory)
  await p
  assert.equal(controller.view(), 'view')
  assert.deepEqual(controller.modal(), { body: 'form' })
  await controller.prepare()
  assert.equal(creations, 1)
  controller.reset()
  assert.equal(resets, 1)
  controller.dispose()
  await controller.prepare()
  assert.equal(creations, 1)
})
