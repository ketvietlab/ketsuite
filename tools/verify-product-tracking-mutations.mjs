import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    [
      '--test',
      '--test-name-pattern=^P8 Commerce',
      '.build/test/product-modal-view.test.js',
      '.build/test/product-tracking-http.test.js',
    ],
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
    'quantity loses inventory',
    'product_backend/modal/inventory-tracking.js',
    "isStorable: mode !== 'none'",
    "isStorable: mode === 'lot'",
  ],
  [
    'overwrite serial setup',
    'product_backend/modal/product-modal-view.js',
    "(c.creating || c.data.record.tracking !== 'serial')",
    'true',
  ],
  [
    'clear omitted inventory field',
    'product_backend/modal/product-modal-view.js',
    "form.has('inventoryTracking') &&",
    'true &&',
  ],
  [
    'lose field refusal',
    'product_backend/modal/product-modal-view.js',
    "c.fieldError('tracking') ?? c.fieldError('isStorable')",
    'null',
  ],
  [
    'drop Commerce presentation option',
    'product_backend/modal/product-workspace-context.js',
    'options.combinedInventoryTracking ?',
    'false ?',
  ],
]

const selected = cases
for (const [name, file, before, after] of selected) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file),
    original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length, 2, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: survived`)
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic assertion required`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
  }
}
const restored = run()
assert.equal(restored.status, 0, restored.stdout + restored.stderr)
console.log(
  `${selected.length}/${selected.length} killed; emitted bytes restored; baseline passed before and after`,
)
