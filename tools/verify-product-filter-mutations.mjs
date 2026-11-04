import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '.build/test/product-filters-http.test.js', '.build/test/product-filters-ui.test.js'],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['allow long names', 'backend/saved-search-policy.js', '[...name].length > 60', '[...name].length > 600'],
  [
    'allow editing shared owner',
    'backend/saved-search-policy.js',
    'current.ownerId !== ctx.actor ||',
    'false ||',
  ],
  [
    'ignore delete revision',
    'backend/saved-search-policy.js',
    "if (args.expectedRevisionId != null && args.expectedRevisionId !== (row.revisionId ?? 'initial'))",
    'if (false)',
  ],
  [
    'leak shared across companies',
    'backend/saved-search-policy.js',
    "and(eq(S.shared, true), eq(S.companyId, ctx.scope.company ?? ''))",
    'eq(S.shared, true)',
  ],
  ['ignore use on SKUs', 'product/use-filter.js', "if (use === 'notSold')", 'if (false)'],
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
