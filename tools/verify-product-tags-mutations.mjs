import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-tags-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
for (const [name, file, before, after] of [
  ['accept long tag names', 'functions/tags.js', '[...name].length > 30', 'false'],
  ['allow more than ten tags', 'tag-policy.js', 'ids.length > MAX_PRODUCT_TAGS', 'false'],
  ['assign archived tags to new products', 'tag-policy.js', 'row.active !== false || held.has(id)', 'true'],
  ['forget tag field permission', 'functions/record.js', "general.push('tagIds')", 'void 0'],
  [
    'drop assignment persistence',
    'functions/templates.js',
    'await writeTemplateTags(tx, args.id, tagIds)',
    'void 0',
  ],
]) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules/product', file),
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
console.log('5/5 killed; emitted bytes restored; baseline passed before and after')
