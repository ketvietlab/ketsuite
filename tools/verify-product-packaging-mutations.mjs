import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-packaging-grid-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['row limit', 'product/packaging-grid.js', 'rows.size > 20', 'rows.size > 200'],
  ['scope overlap', 'product/packaging-grid.js', 'if (overlaps(row, other))', 'if (false)'],
  [
    'shared barcode',
    'product/packaging-grid.js',
    "if (row.barcode && row.productId === '*' && !held.singleProductId)",
    'if (false)',
  ],
  [
    'internal permission',
    'product/packaging-grid.js',
    "if (!(await holdsFunction(ctx, 'product.savePackagingGrid')))",
    'if (false)',
  ],
  [
    'stale revision',
    'product/packaging-grid.js',
    "if (args.expectedRevisionId !== (template.revisionId ?? 'initial'))",
    'if (false)',
  ],
  ['one-save integration', 'product/save-record.js', "if (Object.hasOwn(args, 'packagings'))", 'if (false)'],
  [
    'legacy writer revision',
    'product/functions/packaging.js',
    "await claimProductCodeRevision(ctx, template);\n        await ctx.db.insertIfAbsent('product.TemplateUom',",
    "await ctx.db.insertIfAbsent('product.TemplateUom',",
  ],
  [
    'barcode batch clear',
    'product/packaging-grid.js',
    'for (const link of changing)',
    'for (const link of [])',
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
