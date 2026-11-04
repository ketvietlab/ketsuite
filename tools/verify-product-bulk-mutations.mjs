import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '.build/test/product-bulk-edit-http.test.js', '.build/test/product-bulk-edit-ui.test.js'],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['accept 201 selections', 'product/bulk-edit.js', 'selected.length > 200', 'selected.length > 2000'],
  ['rewrite no-op products', 'product/bulk-edit.js', 'if (!change.changed)', 'if (false)'],
  [
    'omit outer transaction',
    'product/bulk-edit.js',
    'return ctx.tx(async (tx) => {',
    'return (async work => work(ctx))(async (tx) => {',
  ],
  [
    'accept changed replay',
    'product/bulk-edit.js',
    'if (!isDeepStrictEqual(previous.request, request))',
    'if (false)',
  ],
  [
    'omit product history',
    'product/bulk-edit.js',
    "await tx.db.insert('product.BulkEditItem', item);",
    'await Promise.resolve(item);',
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
