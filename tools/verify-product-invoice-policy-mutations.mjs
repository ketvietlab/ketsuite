import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/product-invoice-policy-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'effective policy',
    'sale/functions/policies.js',
    'invoicePolicy: soldInvoicePolicy(template, await salesConfiguration(ctx))',
    "invoicePolicy: template.invoicePolicy ?? 'order'",
  ],
  ['combo policy', 'sale/functions/policies.js', "!template || template.type === 'combo'", '!template'],
  [
    'record identity',
    'sale/functions/policies.js',
    "getProductInvoicePolicyHandler(ctx, args) {\n    const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0];",
    "getProductInvoicePolicyHandler(ctx, args) {\n    const template = (await ctx.db.select('product.Template', {}))[0];",
  ],
  [
    'policy permission',
    'product_backend/modal/product-workspace-context.js',
    'invoicePolicy: invoicePolicy?.invoicePolicy ?? null',
    "invoicePolicy: invoicePolicy?.invoicePolicy ?? 'order'",
  ],
  [
    'revenue permission',
    'product_backend/modal/product-workspace-context.js',
    'revenue: money ? sales.revenue : null',
    'revenue: sales.revenue',
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
