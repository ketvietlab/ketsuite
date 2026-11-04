import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMenu, compose } from '@ketvietlab/ketjs'
import { createKetsuiteDeployment } from '../packages/ketsuite/src/deployment.ts'

const deployment = createKetsuiteDeployment()
const manifest = compose(
  [...deployment.modules, ...(deployment.theme ? [deployment.theme] : []), ...(deployment.themes ?? [])],
  { companies: true },
)

// `admin.*` headings are the blocks of the settings page the rail's gear opens.
const configurationGroups = new Set([
  'admin.access',
  'admin.config',
  'admin.crm',
  'admin.product',
  'admin.accounting',
  'hospitality.configuration',
  'pos.configGroup',
  'admin.stock',
  'admin.sale',
  'admin.manufacturing',
])
// Accounting's own sidebar groups its day (mock A11). Vietnam's modules add to them, so a group
// may hold a single entry in this public deployment.
const accountingGroups = new Set(['accounting.documents', 'accounting.treasury', 'accounting.ledger'])
// A module with a single configuration screen still has its block on the settings page.
const singleScreenSettings = new Set(['admin.manufacturing'])

test('KétSuite sidebar is two levels except multi-screen configuration groups', () => {
  for (const [id, entry] of Object.entries(manifest.menus)) {
    if (!entry.parent) continue
    const parent = manifest.menus[entry.parent]
    assert.ok(parent, `${id} has an unknown parent`)
    if (parent.parent) {
      assert.ok(
        configurationGroups.has(entry.parent) || accountingGroups.has(entry.parent),
        `${id} creates an unexpected third level`,
      )
      assert.equal(manifest.menus[parent.parent]!.parent, undefined, `${id} creates a fourth level`)
    }
    if (!entry.path) {
      const entries = Object.values(manifest.menus).filter((child) => child.parent === id).length
      if (accountingGroups.has(id) || singleScreenSettings.has(id)) assert.ok(entries >= 1, id)
      else {
        assert.ok(configurationGroups.has(id), `${id} is an unnecessary intermediate heading`)
        assert.ok(entries >= 2, id)
      }
    }
  }
  for (const id of configurationGroups) {
    assert.ok(manifest.menus[id], `${id} must retain its configuration group`)
  }
})

test('Product shows templates and variants directly, with a two-level active trail', () => {
  const tree = buildMenu(manifest, { active: '/admin/product/templates' })
  const product = tree.find((node) => node.id === 'product')!
  assert.ok(product.active)
  // Variants (P13) follow the products they belong to; attributes and units are configuration (#1665).
  assert.deepEqual(
    product.children.map((node) => node.id),
    ['product.templates', 'product.variants'],
  )
  assert.equal(product.children[0]!.path, '/admin/product/templates')
  assert.ok(product.children[0]!.active)
  assert.equal(product.children[1]!.path, '/admin/product/variants')
  assert.equal(product.children[1]!.active, false)
  const onVariants = buildMenu(manifest, { active: '/admin/product/variants' }).find(
    (node) => node.id === 'product',
  )!
  assert.equal(onVariants.children[0]!.active, false)
  assert.ok(onVariants.children[1]!.active)
})

test('#1665 attributes and units sit behind the gear, after the catalogue settings', () => {
  const settings = buildMenu(manifest, { active: '/admin/product/uoms' })
    .find((node) => node.id === 'admin')!
    .children.find((node) => node.id === 'admin.product')!
  assert.deepEqual(
    settings.children.map((node) => node.id),
    [
      'admin.product.categories',
      'admin.product.tags',
      'admin.product.combos',
      'admin.product.imports',
      'product.attributes',
      'product.uoms',
    ],
  )
  assert.ok(settings.children.at(-1)!.active)
  const allowed = buildMenu(manifest, { allow: ['product.listAttributes'] })
  assert.equal(
    allowed.find((node) => node.id === 'product'),
    undefined,
  )
  assert.deepEqual(
    allowed
      .find((node) => node.id === 'admin')
      ?.children.find((node) => node.id === 'admin.product')
      ?.children.map((node) => node.id),
    ['product.attributes'],
  )
})

test('flattened Product menus retain permission filtering and search', () => {
  assert.equal(
    buildMenu(manifest, { allow: [] }).some((node) => node.id === 'product'),
    false,
  )
  const searched = buildMenu(manifest, {
    q: 'Mẫu sản phẩm',
    translate: (key) => (key === 'product_backend.menu.templates' ? 'Mẫu sản phẩm' : key),
  })
  assert.deepEqual(
    searched.find((node) => node.id === 'product')?.children.map((node) => node.id),
    ['product.templates'],
  )
})

test('hotel operational screens are direct while configuration keeps its children', () => {
  const tree = buildMenu(manifest)
  const hotel = tree.find((node) => node.id === 'hospitality')!.children.map((node) => node.id)
  assert.ok(hotel.includes('hospitality.billing'))
  assert.ok(hotel.indexOf('hospitality.billing') < hotel.indexOf('hospitality.cleaningTasks'))
  assert.ok(hotel.indexOf('hospitality.cleaningTasks') < hotel.indexOf('hospitality.configuration'))
  assert.equal(manifest.menus['hospitality.billingRules']!.parent, 'hospitality.configuration')
  assert.equal(manifest.menus['admin.companies']!.parent, 'admin.config')
  const limited = buildMenu(manifest, { allow: ['hospitality_billing.listChargeRules'] })
  const configuration = limited.find((node) => node.id === 'hospitality')!.children[0]!
  assert.equal(configuration.id, 'hospitality.configuration')
  assert.deepEqual(
    configuration.children.map((node) => node.id),
    ['hospitality.billingRules'],
  )
})
