// P40 Commerce: semantic mutations of emitted query code, restored between cases.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-category-filter-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
assert.equal(run().status, 0, 'baseline must pass')
const cases = [
  ['stop at root', 'product/category-tree.js', 'children.get(pending[i]) ?? []', '[]'],
  [
    'variants use only exact category',
    'product_backend/variants/read.js',
    'categoryDescendants(categories, [query.categoryId])',
    'new Set([query.categoryId])',
  ],
  [
    'invert exclusion',
    'product/category-tree.js',
    "node.operator === 'notEquals' ? not(matched) : matched",
    'matched',
  ],
  ['flatten OR into AND', 'product/category-tree.js', "(node.op === 'and' ? and : or)", 'and'],
]
for (const [name, file, before, after] of cases) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file),
    original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length, 2, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: survived`)
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic failure required`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
    assert.equal(readFileSync(path, 'utf8'), original)
  }
}
assert.equal(run().status, 0, 'restored baseline must pass')
console.log('4/4 killed; emitted bytes restored; baseline passed before and after')
