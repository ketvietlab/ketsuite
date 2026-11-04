// Commerce P36: mutate emitted modules only; restore bytes before the next case.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const cases = [
  [
    'unit eligibility',
    'sale/functions/lines.js',
    'sellableProduct(ctx, args.productId, args.productUomId)',
    'sellableProduct(ctx, args.productId, args.productUomId, { allowMeasurementTreeUom: true })',
    'sale-packaging-http',
    'refuses a same-tree',
  ],
  [
    'list price conversion',
    'sale/functions/lines.js',
    "multiplyDecimals(context.listPrice, ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }))",
    'context.listPrice',
    'sale-packaging-http',
    'prices one packaging',
  ],
  [
    'pricelist conversion',
    'sale/functions/lines.js',
    "multiplyDecimals(priced.price, ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }))",
    'priced.price',
    'sale-packaging-http',
    'base-unit pricelist',
  ],
  [
    'delivered conversion',
    'sale/functions/deliveries.js',
    'delivered += n(move.quantity) * ratio;',
    'delivered += n(move.quantity);',
    'sale-packaging-http',
    'packaged delivery stays',
  ],
  [
    'unit search',
    'sale/functions/line-units.js',
    'fold(unit.name).includes(search)',
    'true',
    'sale-packaging-http',
    'packaging choices follow',
  ],
  [
    'modal parent draft',
    'sale_backend/modal/order-modal-view.js',
    "listInput: { productId: c.draft('productId', '') }",
    "listInput: { productId: '' }",
    'sale-packaging-modal',
    'rehydrates',
  ],
  [
    'modal reset',
    'sale_backend/modal/order-modal-view.js',
    "resetRelationsOnChange: { productId: ['productUomId'] }",
    'resetRelationsOnChange: {}',
    'sale-packaging-modal',
    'rehydrates',
  ],
  [
    'modal guide',
    'sale_backend/modal/order-modal-view.js',
    'id: "sale-order-add-line-help"',
    'id: "wrong-guide"',
    'sale-packaging-modal',
    'translated Help',
  ],
  [
    'cost price conversion',
    'sale/functions/lines.js',
    "multiplyDecimals(priced.price, ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }))",
    'priced.price',
    'sale-packaging-http',
    'cost-based prices',
  ],
  [
    'small factor decimal',
    'sale/functions/lines.js',
    "multiplyDecimals(context.listPrice, ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }))",
    'multiplyDecimals(context.listPrice, String(ratio))',
    'sale-packaging-http',
    'cost-based prices',
  ],
  [
    'saved unit label',
    'sale/functions/queries.js',
    'productUomName: unitNames.get(String(line.productUomId)) ?? String(line.productUomId)',
    'productUomName: String(line.productUomId)',
    'sale-packaging-http',
    'prices one packaging',
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
