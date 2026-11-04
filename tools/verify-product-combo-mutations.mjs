import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '.build/test/product-combos-http.test.js', '.build/test/product-combos-ui.test.js'],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'allow 41-character names',
    'product/functions/combos.js',
    '[...name].length > 40',
    '[...name].length > 400',
  ],
  ['allow 21 items', 'product/combo-policy.js', 'value.length > MAX_COMBO_ITEMS', 'value.length > 200'],
  ['accept negative extra prices', 'product/combo-policy.js', '/^\\d{1,10}$/', '/^-?\\d{1,11}$/'],
  ['hide held retired items', 'product/combo-policy.js', '!held.has(item.productId)', 'true'],
  ['archive a used choice', 'product/functions/combos.js', 'args.active === false &&', 'false &&'],
  [
    'overwrite a stale choice',
    'product/functions/combos.js',
    'current && args.expectedRevisionId !== current.revisionId',
    'false',
  ],
  [
    'register a read-only grid as a form field',
    'product_backend/modal/combo-modal-view.js',
    'const editable = c.data.permissions.edit;',
    'const editable = true;',
  ],
  [
    'mark a clean grid draft as changed',
    'product_backend/modal/combo-modal-view.js',
    "c.draft('items', JSON.stringify({ added: [], updated: [], removed: [], order: null }))",
    "c.draft('items', '')",
  ],
]
const selected = process.argv.includes('--grid-only') ? cases.slice(-2) : cases
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
