import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '.build/test/supplier-replenishment-http.test.js'],
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
    'ignore already ordered receipts',
    'stock/replenishment-policy.js',
    'onOrder += quantity;',
    'onOrder += 0;',
  ],
  [
    'include late commitments',
    'stock/replenishment-policy.js',
    'String(picking.scheduledDate) > horizon',
    'false',
  ],
  ['ignore outbound demand', 'stock/replenishment-policy.js', 'outgoing += quantity;', 'outgoing += 0;'],
  [
    'round down procurement',
    'stock/replenishment-policy.js',
    'Math.ceil(raw / rounding - 1e-12)',
    'Math.floor(raw / rounding - 1e-12)',
  ],
  [
    'drop receipt supplier',
    'stock/functions/orderpoints.js',
    'partnerId: vendor.partnerId,',
    'partnerId: null,',
  ],
  [
    'mix supplier receipt groups',
    'stock/functions/orderpoints.js',
    '                vendor.partnerId,',
    '                null,',
  ],
  [
    'lose backorder supplier',
    'stock/functions/pickings.js',
    'partnerId: current.partnerId ?? null,',
    'partnerId: null,',
  ],
  [
    'accept archived destination',
    'stock/functions/orderpoints.js',
    'destination.active === false ||',
    'false ||',
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
