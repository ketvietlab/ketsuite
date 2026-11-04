import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '.build/test/delivery-promises-http.test.js'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'reverse once policy',
    'sale/delivery-promise.js',
    "order.shippingPolicy === 'one'",
    "order.shippingPolicy !== 'one'",
  ],
  ['include services', 'sale/delivery-promise.js', "template?.type !== 'goods'", 'false'],
  [
    'anchor on quotation after confirmation',
    'sale/delivery-promise.js',
    'order.confirmedAt ?? order.dateOrder',
    'order.dateOrder',
  ],
  [
    'ignore commitment schedule',
    'sale/functions/delivery-promise.js',
    'current.commitmentDate || expectedDate',
    'expectedDate',
  ],
  [
    'reschedule completed transfers',
    'sale/functions/delivery-promise.js',
    "['done', 'cancel'].includes(String(picking.state))",
    'false',
  ],
  [
    'accept stale revision',
    'sale/functions/delivery-promise.js',
    '!(await claimRevision(tx, order, args.expectedRevision))',
    'false',
  ],
  ['allow days above one year', 'product/functions/templates.js', 'min: 0, max: 365', 'min: 0, max: 999'],
  [
    'omit company timezone',
    'sale/delivery-promise.js',
    'companyCivilDate(ctx, text)',
    'Promise.resolve(text.slice(0, 10))',
  ],
]

for (const [name, file, before, after] of cases) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file)
  const original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length - 1, 1, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: survived`)
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic failure required`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
  }
}
const restored = run()
assert.equal(restored.status, 0, restored.stdout + restored.stderr)
console.log(`${cases.length}/${cases.length} killed; emitted bytes restored; baselines passed`)
