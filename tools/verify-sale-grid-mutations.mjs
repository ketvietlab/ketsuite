// Commerce P36b: mutate emitted modules only; restore bytes before the next case.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const cases = [
  [
    'stale revision',
    'sale/functions/line-grid.js',
    'Number(order.revision) !== Number(args.expectedRevision)',
    'false',
    'sale-line-grid-http',
    'mixed patch',
  ],
  [
    'foreign line ownership',
    'sale/functions/line-grid.js',
    '!known.has(id)',
    'false',
    'sale-line-grid-http',
    'rolls back',
  ],
  [
    'writable fields',
    'sale/functions/line-grid.js',
    '!fields.has(key)',
    'false',
    'sale-line-grid-http',
    'rolls back',
  ],
  [
    'exact price',
    'sale/functions/line-grid.js',
    'decimal(line.priceUnit)',
    "Number(line.priceUnit).toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })",
    'sale-line-grid-http',
    'mixed patch',
  ],
  [
    'retained tax',
    'sale/functions/lines.js',
    'taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : [])',
    'taxIds: []',
    'sale-line-grid-http',
    'mixed patch',
  ],
  [
    'visible refusal',
    'sale_backend/modal/order-modal-view.js',
    "issueField: () => ''",
    'issueField: (field) => field',
    'sale-packaging-modal',
    'hidden-field refusals',
  ],
  [
    'draft label boundary',
    'sale_backend/modal/line-grid.js',
    'return changes;',
    'return parsed;',
    'sale-packaging-modal',
    'hidden-field refusals',
  ],
]

let killed = 0
for (const [name, file, before, after, test, pattern] of cases) {
  const path = resolve(root, '.build/packages/ketsuite/src/modules', file)
  const original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length, 2, `${name}: unique anchor`)
  try {
    writeFileSync(path, original.replace(before, after))
    const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
    const run = spawnSync(
      process.execPath,
      ['--test', '--test-force-exit', `--test-name-pattern=${pattern}`, `.build/test/${test}.test.js`],
      { cwd: root, encoding: 'utf8', timeout: 60_000 },
    )
    assert.notEqual(run.status, 0, `${name}: mutant survived`)
    assert.match(run.stdout + run.stderr, /AssertionError/, `${name}: semantic failure required`)
    console.log(`KILLED ${name}`)
    killed++
  } finally {
    writeFileSync(path, original)
    assert.equal(readFileSync(path, 'utf8'), original)
  }
}
console.log(`${killed}/${cases.length} killed; all emitted modules restored`)
