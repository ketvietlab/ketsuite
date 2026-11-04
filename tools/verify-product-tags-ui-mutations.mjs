import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-tags-ui-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
for (const [name, file, before, after] of [
  ['ignore tag predicates', 'product_backend/tags/catalogue.js', "rule.field !== 'tagId'", 'true'],
  [
    'drop product tag name search',
    'product_backend/list/read.js',
    '...codeMatches, ...tagMatches',
    '...codeMatches',
  ],
  [
    'drop SKU tag filter',
    'product_backend/variants/read.js',
    'query.tagId ? tags.templates([query.tagId]) : null',
    'null',
  ],
  [
    'hide historical assigned tags',
    'product/product-modal-context.js',
    'tag.active !== false || heldTags.includes(String(tag.id))',
    'tag.active !== false',
  ],
  [
    'forget create-from-source tags',
    'product/functions/record.js',
    'await writeTemplateTags(tx, args.id, copiedTags)',
    'void 0',
  ],
]) {
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
console.log('5/5 killed; emitted bytes restored; baseline passed before and after')
