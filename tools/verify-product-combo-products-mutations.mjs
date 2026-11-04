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
      '--test-name-pattern=P45',
      '.build/test/product-combo-products-http.test.js',
      '.build/test/product-modal-view.test.js',
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['allow eleven choices', 'product/template-combos.js', 'ids.length > 10', 'ids.length > 100'],
  ['accept archived assignments', 'product/template-combos.js', 'row.active !== false ||', 'true ||'],
  ['allow combo variant setup', 'product/variant-setup.js', "template.type === 'combo'", 'false'],
  ['allow combo packaging', 'product/functions/packaging.js', "if (template.type === 'combo')", 'if (false)'],
  ['allow combo stock setup', 'stock/functions/products.js', "template.type === 'combo' &&", 'false &&'],
  ['block allocated combo sale', 'sale/functions/lines.js', 'allowCombo: !child', 'allowCombo: false'],
  [
    'hide combo choices from General',
    'product_backend/modal/product-modal-view.js',
    "c.draft('type', c.data.record.type) === 'combo'",
    'false',
  ],
]
const selected = cases
for (const [name, file, before, after] of selected) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file),
    original = readFileSync(path, 'utf8')
  assert.ok(original.includes(before), `${name}: anchor exists`)
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
