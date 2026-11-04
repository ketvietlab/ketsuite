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
      '--test-name-pattern=P58|P48 native supplier',
      '.build/test/product-navigation-http.test.js',
      '.build/test/product-modal-view.test.js',
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'drop company and branch',
    'product_backend/navigation.js',
    "const context = ['company', 'branch', 'lang'];",
    "const context = ['lang'];",
  ],
  [
    'accept foreign return context',
    'product_backend/navigation.js',
    "target.origin === 'http://ket.local' &&",
    'true &&',
  ],
  [
    'dirty empty supplier grid',
    'product_backend/modal/supplier-grid.js',
    "c.draft('supplierChanges', emptyChanges)",
    "c.draft('supplierChanges', '')",
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
