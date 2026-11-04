// Focused mutation proof. Mutates emitted test artifacts only and restores each in finally.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** @param {string} path */
const moduleFile = (path) => resolve(root, '.build/packages/ketsuite/src/modules', path)
const cases = [
  [
    'attribute multi policy',
    'product/attribute-policy.js',
    "next.displayType === 'multi' && next.createVariant !== 'no_variant'",
    'false',
    'product-attribute-policy-http',
    'mode and name rules',
  ],
  [
    'used attribute policy',
    'product/attribute-policy.js',
    'current && (next.createVariant !== current.createVariant || next.active === false)',
    'false',
    'product-attribute-policy-http',
    'blocks used attribute',
  ],
  [
    'used value removal',
    'product/attribute-draft.js',
    "(await tx.db.select('product.TemplateAttributeValue', { valueId: value.id })).length > 0",
    'false',
    'product-attribute-policy-http',
    'blocks used attribute',
  ],
  [
    'used value reassignment',
    'product/functions/attributes.js',
    'existing.attributeId !== args.attributeId &&',
    'false &&',
    'product-attribute-policy-http',
    'blocks used attribute',
  ],
  [
    'variant ceiling',
    'product/variant-policy.js',
    'VARIANT_LIMIT = 50',
    'VARIANT_LIMIT = 256',
    'product-attribute-policy-http',
    '50 variant ceiling',
  ],
  [
    'default attribute extra',
    'product/configure-attributes.js',
    'own.find((row) => row.id === value.valueId)?.defaultPriceExtra ||',
    '',
    'product-attribute-policy-http',
    'default attribute extras',
  ],
  [
    'company attribute uniqueness',
    'product/company-catalogue.js',
    "name_key: ['nameKey', 'companyId']",
    "name_key: ['nameKey']",
    'product-attribute-policy-http',
    'mode and name rules',
  ],
  [
    'archived attribute attachment',
    'product/variant-setup.js',
    'attribute.active === false && !heldLineIds.has(line.attributeId)',
    'false',
    'product-attribute-policy-http',
    'archives and restores unused',
  ],
  [
    'GS1 validation',
    'product/barcodes.js',
    'if (code && !validGtin(code))',
    'if (false)',
    'product-barcodes-http',
    'writes validate GS1',
  ],
  [
    'legacy cross-model collisions',
    'product/barcodes.js',
    "['product.ProductUom', 'packaging'],",
    '',
    'product-barcodes-http',
    'migration preserves legacy',
  ],
  [
    'FEFO removal ordering',
    'stock/stock-ledger.js',
    'fefoTime(lots.get(String(left.lotId))) - fefoTime(lots.get(String(right.lotId))) ||',
    '',
    'stock-lot-policy-http',
    'FEFO uses removal',
  ],
  [
    'quarantine exclusion',
    'stock/lot-policy.js',
    ' || lot.quarantined === true',
    '',
    'stock-lot-policy-http',
    'FEFO uses removal',
  ],
  [
    'manual date preservation',
    'stock/lot-policy.js',
    '(!held || instant(held) === instant(automatic[field]))',
    'true',
    'stock-lot-policy-http',
    'dates preserve manual',
  ],
  [
    'removal-date completion check',
    'stock/lot-policy.js',
    "['expirationDate', 'removalDate'].every",
    "['expirationDate'].every",
    'stock-lot-policy-http',
    'rechecks dates at completion',
  ],
  [
    'initial quarantine audit',
    'stock/functions/lots.js',
    '(existing && policyChanged) || (!existing && quarantined)',
    'existing && policyChanged',
    'stock-lot-policy-http',
    'audit retains initial quarantine',
  ],
  [
    'cleared date audit',
    'stock/functions/lots.js',
    'Object.hasOwn(values, field) ? values[field] : (existing?.[field] ?? null)',
    'values[field] ?? existing?.[field] ?? null',
    'stock-lot-policy-http',
    'audit retains initial quarantine',
  ],
]
let killed = 0
for (const [name, file, before, after, test, pattern] of cases) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue
  const path = moduleFile(file)
  const original = readFileSync(path, 'utf8')
  assert.equal(original.split(before).length, 2, `${name}: mutation anchor is unique`)
  try {
    writeFileSync(path, original.replace(before, after))
    const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
    const run = spawnSync(
      process.execPath,
      ['--test', '--test-force-exit', `--test-name-pattern=${pattern}`, `.build/test/${test}.test.js`],
      { cwd: root, encoding: 'utf8', timeout: 60_000 },
    )
    assert.notEqual(run.status, 0, `${name}: mutated old behavior survived`)
    assert.match(run.stdout + run.stderr, /AssertionError/, `${name}: expected a semantic assertion failure`)
    console.log(`KILLED ${name}`)
    killed += 1
  } finally {
    writeFileSync(path, original)
  }
}
console.log(`${killed} selected mutations killed; emitted modules restored`)
