import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '.build/test/purchase-supplier-selection-http.test.js'],
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
    'reverse supplier priority',
    'purchase/supplier-selection.js',
    'n(a.sequence) - n(b.sequence)',
    'n(b.sequence) - n(a.sequence)',
  ],
  [
    'ignore minimum threshold',
    'purchase/supplier-selection.js',
    'quantityInSupplierUnit >= n(row.minQty)',
    'true',
  ],
  ['lose first-row fallback', 'purchase/supplier-selection.js', 'return first;', 'return null;'],
  ['accept inactive supplier', 'purchase/supplier-selection.js', 'partner.active !== false', 'true'],
  [
    'accept foreign company',
    'purchase/supplier-selection.js',
    'String(row.companyId) === ctx.scope.company',
    'true',
  ],
  [
    'accept unrelated variant',
    'purchase/supplier-selection.js',
    '!row.productId || row.productId === args.productId',
    'true',
  ],
  [
    'skip quantity conversion',
    'purchase/supplier-selection.js',
    'await inUnit(ctx, args.quantity, args.uomId, row.productUomId)',
    'args.quantity',
  ],
  ['skip price conversion', 'purchase/supplier-selection.js', 'String(selected.unitsPerOrderUnit)', '"1"'],
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
