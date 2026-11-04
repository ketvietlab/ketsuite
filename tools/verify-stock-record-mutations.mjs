import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const run = () =>
  spawnSync(process.execPath, ['--test', '.build/test/stock-record-permissions-http.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  })
const baseline = run()
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
const cases = [
  [
    'unconditional chatter',
    'stock_mail_backend/index.js',
    '{% if may.stock_mail_backend.timeline %}',
    '{% if true %}',
  ],
  [
    'deny authorized chatter',
    'stock_mail_backend/index.js',
    '{% if may.stock_mail_backend.timeline %}',
    '{% if false %}',
  ],
  [
    'unconditional optional product read',
    'stock_backend/routes.js',
    "optionalRead(ctx, 'stock.listStorableProducts', {}, url, req, [])",
    "ctx.call('stock.listStorableProducts', {}, url, req)",
  ],
  [
    'show forbidden confirmation',
    'stock_backend/screens/transfer-detail.js',
    'options.permissions.confirmPicking &&',
    'true &&',
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
