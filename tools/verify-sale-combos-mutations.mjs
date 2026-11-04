import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '--test-concurrency=1', '.build/test/sale-combos-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['lose last remainder', 'sale/combo-lines.js', '? left\n', '? 0n\n'],
  ['omit item extras', 'sale/combo-lines.js', 'share + moneyMinor(extras[index], scale)', 'share'],
  ['ignore selected item', 'sale/combo-lines.js', 'const item = selected ?', 'const item = false ?'],
  ['accept forged child fields', 'sale/functions/lines.js', 'if (!previous?.comboParentId)', 'if (true)'],
  ['invoice parent', 'sale/functions/invoices.js', 'if (line.comboBasePrice != null)', 'if (false)'],
  ['reallocate historical prices', 'sale/functions/line-edit.js', 'if (history) {', 'if (false) {'],
  ['shrink picked demand', 'stock/move-demand.js', 'if (demand + 0.000001 < picked)', 'if (false)'],
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
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: semantic failure required`)
    console.log(`KILLED ${name}`)
  } finally {
    writeFileSync(path, original)
  }
}
const restored = run()
assert.equal(restored.status, 0, restored.stdout + restored.stderr)
console.log(`${cases.length}/${cases.length} killed; emitted bytes restored; baselines passed`)
