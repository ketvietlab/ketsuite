// P39 Commerce: emitted code only; each mutation must cause a semantic assertion.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-category-lifecycle-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
assert.equal(run().status, 0, 'baseline must pass')
const cases = [
  ['allow long names', 'category-write.js', '[...name].length > 40', 'false'],
  ['allow slash names', 'category-write.js', "name.includes('/')", 'false'],
  [
    'ignore legacy sibling names',
    'category-write.js',
    'rows.some((row) => row.id !== args.id && categoryNameKey(row.parentId, row.name) === nameKey)',
    'false',
  ],
  [
    'ignore category usage',
    'functions/classification.js',
    '(await categoryInUse(tx, String(args.id), rows))',
    'false',
  ],
  [
    'restore below archived parent',
    'functions/classification.js',
    '!rows.some((row) => row.id === existing.parentId && row.active !== false)',
    'false',
  ],
  ['allow archived assignments', 'category-policy.js', 'rows[0].active === false', 'false'],
]
for (const [name, file, before, after] of cases) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules/product', file)
  const original = readFileSync(path, 'utf8')
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
console.log('6/6 killed; emitted bytes restored; baseline passed before and after')
