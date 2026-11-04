import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    [
      '--test',
      '.build/test/product-import-format.test.js',
      '.build/test/product-imports-http.test.js',
      '.build/test/product-imports-ui.test.js',
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['accept 501 rows', 'product/import-format.js', 'rows: 500,', 'rows: 5000,'],
  ['accept oversized source', 'product/import-format.js', 'bytes: 256 * 1024', 'bytes: 512 * 1024'],
  [
    'save unchanged products',
    'product/import-execution.js',
    'const changedGeneral = !existing ||',
    'const changedGeneral = true ||',
  ],
  ['expose receipt costs', 'product/import-history.js', 'if (!cost) {', 'if (false) {'],
  [
    'expose exported costs',
    'product/functions/import-export.js',
    "const costAllowed = await holdsFunction(ctx, 'product.listVariantCosts');",
    'const costAllowed = true;',
  ],
  [
    'accept changed replay source',
    'product/functions/imports.js',
    'if (previous.data !== args.data)',
    'if (false)',
  ],
  [
    'write outside atomic transaction',
    'product/functions/imports.js',
    'return await ctx.tx(async (tx) => {',
    'return await (async work => work(ctx))(async (tx) => {',
  ],
  [
    'allow stocked cost edits',
    'product/save-cost.js',
    'if (await hasPhysicalStock(tx, [String(args.productId)]))',
    'if (false)',
  ],
  [
    'make saved source editable',
    'product_backend/modal/import-modal-view.js',
    'readOnly: true',
    'readOnly: false',
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
