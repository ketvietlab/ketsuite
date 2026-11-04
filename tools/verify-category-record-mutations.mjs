// Mutate emitted code only. Each counterexample must fail a semantic assertion.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const path = resolve(root, '.build/packages/ketsuite/src/modules/product/functions/category-record.js')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-category-record-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
assert.equal(run().status, 0, 'baseline passes')
const original = readFileSync(path, 'utf8')
/** @type {Array<[string, string, string, number]>} */
const mutations = [
  ['bypass general field permission', "await holdsFunction(ctx, 'product.saveCategory')", 'true', 1],
  ['ignore stale revision', 'args.expectedRevision !== categoryRevision(current, accounts)', 'false', 1],
  ['commit a refused partial write', 'throw new Refused(saved)', 'return saved', 2],
]
for (const [name, before, after, count] of mutations) {
  assert.equal(original.split(before).length - 1, count, `${name}: anchor count`)
  try {
    writeFileSync(path, original.replaceAll(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: survived`)
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic assertion`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
  }
}
assert.equal(readFileSync(path, 'utf8'), original)
assert.equal(run().status, 0, 'restored baseline passes')
console.log('3/3 killed; emitted bytes restored; baseline passed before and after')
