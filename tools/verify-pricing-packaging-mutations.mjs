// Commerce P37: mutate emitted modules only; restore bytes before the next case.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const cases = [
  [
    'package fixed amount',
    'pricing/line-price.js',
    "rule.uomId ? '1' : ratio",
    'ratio',
    'pricing-packaging-http',
    'package rule wins',
  ],
  [
    'package priority',
    'pricing/rule-selection.js',
    'if (packaging)',
    'if (false)',
    'pricing-packaging-http',
    'package rule wins',
  ],
  [
    'package quantity threshold',
    'pricing/functions/line-price.js',
    'String(args.quantity),',
    'String(Number(args.quantity) * ratio),',
    'pricing-packaging-http',
    'quantity thresholds',
  ],
  [
    'template package extras',
    'pricing/line-price.js',
    'multiplyDecimals(extra, ratio)',
    "multiplyDecimals(extra, '1')",
    'pricing-packaging-http',
    'variant scope outranks',
  ],
  [
    'packaging eligibility',
    'pricing/functions/save-item.js',
    '!packaging.units.some((unit) => unit.id === uomId)',
    'false',
    'pricing-packaging-http',
    'packaging eligibility',
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
