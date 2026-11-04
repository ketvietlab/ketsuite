// Commerce P40: mutate emitted code only and restore exact bytes after every case.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const path = resolve(root, '.build/packages/ketsuite/src/modules/pricing/rule-selection.js')
const original = readFileSync(path, 'utf8')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/pricing-category-priority-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
assert.equal(run().status, 0, 'baseline must pass')
for (const [name, before, after] of [
  ['ignore category specificity', 'if (category)', 'if (false)'],
  ['prefer the furthest ancestor', 'return category;', 'return -category;'],
]) {
  assert.equal(original.split(before).length, 2, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: mutant survived`)
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic failure required`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
    assert.equal(readFileSync(path, 'utf8'), original)
  }
}
assert.equal(run().status, 0, 'restored baseline must pass')
console.log('2/2 killed; emitted bytes restored; baseline passed before and after')
