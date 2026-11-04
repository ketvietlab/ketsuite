// Commerce P36c: mutate emitted modules only; restore bytes before the next case.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const cases = [
  [
    'selling-unit factor',
    'sale/line-cost.js',
    'multiplyDecimals(baseCost, factor)',
    "multiplyDecimals(baseCost, '1')",
    'sale-line-costs-http',
    'captures exact',
  ],
  [
    'missing cost is not zero',
    'sale/line-cost.js',
    'unitCost: baseCost === null ? null :',
    "unitCost: baseCost === null ? '0' :",
    'sale-line-costs-http',
    'distinguishes missing',
  ],
  [
    'changed unit cannot retain cost',
    'sale/line-cost.js',
    'previous?.productUomId === line.productUomId',
    'true',
    'sale-line-costs-http',
    'retains missing',
  ],
  [
    'atomic public add-line',
    'sale/index.js',
    'handler: addLineCommandHandler',
    'handler: functions.addLine.handler',
    'sale-line-costs-http',
    'persisting its cost snapshot fails',
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
