import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '.build/test/product-search-http.test.js', '.build/test/product-search-ui.test.js'],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'bypass target permissions',
    'product_backend/search/read.js',
    'available.filter((provider) => provider.grants.every(may))',
    'available',
  ],
  ['show blank-query catalogue', 'product_backend/search/read.js', '!query.q || !ctx.actor', '!ctx.actor'],
  [
    'repeat first page',
    'product_backend/search/read.js',
    'let offset = (page - 1) * SEARCH_PAGE_SIZE;',
    'let offset = 0;',
  ],
  [
    'omit packaging barcode',
    'product_backend/variants/read.js',
    'packagingMatches.has(String(row.id))',
    'false',
  ],
  ['omit imported codes', 'product/import-history.js', 'matched.map((item) => item.importId)', '[]'],
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
