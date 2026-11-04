import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '.build/test/product-suppliers-http.test.js'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    },
  )
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['ignore grid cap', 'purchase/functions/product-suppliers.js', 'ids.length > 20', 'ids.length > 200'],
  [
    'accept stale revision',
    'purchase/functions/product-suppliers.js',
    'args.expectedRevision !== revision',
    'false',
  ],
  [
    'expose hidden prices',
    'purchase/functions/product-suppliers.js',
    'rows: await Promise.all(held.map((row) => projectSupplier(ctx, template, row, money)))',
    'rows: await Promise.all(held.map((row) => projectSupplier(ctx, template, row, true)))',
  ],
  ['accept forged prices', 'purchase/functions/product-suppliers.js', 'if (!money &&', 'if (false &&'],
  ['allow invalid lead time', 'purchase/functions/product-suppliers.js', 'delay > 365', 'delay > 366'],
  [
    'skip legacy unit conversion',
    'purchase/functions/product-suppliers.js',
    'String(factor)], scale)',
    "'1'], scale)",
  ],
  ['allow inactive products', 'purchase/product-supplier-policy.js', 'template.active === false ||', ''],
  [
    'rewrite protected company column',
    'purchase/functions/product-suppliers.js',
    "Object.fromEntries([...fields, 'sequence'].map((field) => [field, row[field]]))",
    'row',
  ],
]

for (const [name, file, before, after] of cases) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file)
  const original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length - 1, 1, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0)
    const result = run()
    assert.notEqual(result.status, 0, `${name}: survived`)
    assert.match(
      result.stdout + result.stderr,
      /AssertionError|E_SCOPE_FIELD_WRITTEN|internal error/,
      `${name}: semantic failure required`,
    )
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
  }
}
const restored = run()
assert.equal(restored.status, 0, restored.stdout + restored.stderr)
console.log(`${cases.length}/${cases.length} killed; emitted bytes restored; baselines passed`)
