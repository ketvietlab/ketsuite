import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/sale-free-lines-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  ['free description', 'sale/free-lines.js', 'line.name.trim().length > 0', 'line.name.trim().length >= 0'],
  ['no free unit', 'sale/free-lines.js', '!line.productUomId &&', 'true &&'],
  [
    'confirmation policy',
    'sale/functions/shared.js',
    'if (config.requireProduct && freeLine)',
    'if (false && freeLine)',
  ],
  [
    'configuration revision',
    'sale/functions/configuration.js',
    'if (!config || Number(config.revision) !== Number(args.expectedRevision))',
    'if (!config)',
  ],
  [
    'no free fulfilment',
    'sale/functions/deliveries.js',
    'if (line.comboBasePrice != null || !line.productId)',
    'if (line.comboBasePrice != null)',
  ],
  ['zero free cost', 'sale/functions/line-costs.js', "unitCost: '0'", "unitCost: '1'"],
  [
    'ordered invoice basis',
    'sale/functions/invoices.js',
    "policy = String(context?.template.invoicePolicy ?? 'order')",
    "policy = String(context?.template.invoicePolicy ?? 'delivery')",
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
