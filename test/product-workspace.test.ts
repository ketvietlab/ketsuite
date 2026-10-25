// The product page's reads and writes beyond the template itself: stock by warehouse
// with its min/max rules, recent sales, current vendor prices, attributes configured in
// one action, duplicating, and the page route that composes them for one viewer.

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import {
  account,
  address,
  company,
  partner,
  pricing,
  product,
  purchase,
  sale,
  stock,
  uom,
} from '@ketvietlab/ketsuite'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import {
  productCompleteness,
  productIssues,
  productMargin,
} from '../packages/ketsuite/src/modules/product_backend/modal/product-workspace-context.ts'

const modules = [address, partner, company, uom, product, pricing, stock, account, sale, purchase]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
const call = async <T = Row>(name: string, args: Record<string, unknown>, adapter: Adapter, at = scope) =>
  (await callFn(name, args, { adapter, manifest, scope: at })).value as T

type Stock = NonNullable<Parameters<typeof productIssues>[0]['stock']>
type Refusal = { ok: false; errors: Array<{ field: string; code: string; params?: Record<string, unknown> }> }

const boot = async (t: TestContext) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' }, adapter)
  await call(
    'uom.saveUnit',
    { id: 'box', name: 'Hộp 6', relativeUomId: 'unit', relativeFactor: '6' },
    adapter,
  )
  await call(
    'product.saveTemplate',
    { id: 'goods', name: 'Serum', type: 'goods', uomId: 'unit', listPrice: '100', saleOk: true },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'goods-1', templateId: 'goods', defaultCode: 'G1', combinationKey: '' },
    adapter,
  )
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' }, adapter)
  // Goods come in through an input location first: rules still sit where stock is kept.
  await call(
    'stock.saveWarehouse',
    { id: 'wh', name: 'Kho chính', code: 'WH', receptionSteps: 'two_steps' },
    adapter,
  )
  await call('stock.saveWarehouse', { id: 'wh2', name: 'Kho phụ', code: 'W2' }, adapter)
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['tax', '3331', 'VAT', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call(
    'account.saveJournal',
    { id: 'sales-journal', name: 'Sales', code: 'SAL', type: 'sale' },
    adapter,
  )
  return adapter
}

const adjust = (adapter: Adapter, id: string, counted: string, locationId = 'wh:stock') =>
  call(
    'stock.adjustInventory',
    {
      id,
      productId: 'goods-1',
      locationId,
      inventoryLocationId: 'inventory',
      countedQuantity: counted,
      productUomId: 'unit',
    },
    adapter,
  )

const order = async (
  adapter: Adapter,
  id: string,
  lines: Array<[string, string, string]>,
  confirm = true,
) => {
  await call('sale.createOrder', { id, partnerId: 'customer', warehouseId: 'wh' }, adapter)
  for (const [index, [quantity, unit, price]] of lines.entries())
    await call(
      'sale.addLine',
      {
        id: `${id}:${index}`,
        orderId: id,
        productId: 'goods-1',
        productUomQty: quantity,
        productUomId: unit,
        priceUnit: price,
      },
      adapter,
    )
  if (confirm) assert.equal((await call<Row>('sale.confirmOrder', { id }, adapter)).ok, true)
}

const workspace = (adapter: Adapter) =>
  call<Stock>('stock.productWorkspace', { templateId: 'goods' }, adapter)
const levels = (adapter: Adapter, rules: unknown[], warehouseId = 'wh') =>
  call<Row>('stock.saveProductOrderpoints', { templateId: 'goods', warehouseId, rules }, adapter)

test('product workspace: stock by warehouse, and each rule read against what its variant can sell there', async (t) => {
  const adapter = await boot(t)
  await adjust(adapter, 'count', '10')
  assert.deepEqual(await levels(adapter, [{ productId: 'goods-1', minQuantity: '12', maxQuantity: '30' }]), {
    ok: true,
    saved: 1,
    cleared: 0,
  })
  await order(adapter, 'so-1', [['4', 'unit', '100']])
  // A delivery counts once it is confirmed, as in the forecast.
  assert.equal((await workspace(adapter)).warehouses[0]!.outgoing, 0)
  assert.equal((await call<Row>('stock.confirmPicking', { id: 'so-1:delivery' }, adapter)).ok, true)

  const facts = await workspace(adapter)
  assert.equal(facts.tracked, true)
  assert.equal(facts.inUse, true, 'stock exists, so the unit is fixed')
  assert.deepEqual(
    facts.warehouses.map((row) => row.name),
    ['Kho chính', 'Kho phụ'],
  )
  const [main, second] = facts.warehouses
  assert.equal(main!.onHand, 10)
  assert.equal(main!.outgoing, 4)
  assert.equal(main!.forecasted, 6)
  assert.equal(main!.available, main!.onHand - main!.reserved)
  const forecast = await call<Row>('stock.forecast', { productId: 'goods-1', warehouseId: 'wh' }, adapter)
  for (const key of ['onHand', 'reserved', 'available', 'incoming', 'outgoing', 'forecasted'] as const)
    assert.equal(main![key], Number(forecast[key]), `${key} is the forecast's figure`)
  assert.equal(main!.locationId, 'wh:stock')
  assert.equal(main!.orderpoints.length, 1)
  assert.equal(main!.orderpoints[0]!.locationId, 'wh:stock')
  assert.equal(main!.orderpoints[0]!.minQuantity, 12)
  assert.equal(main!.orderpoints[0]!.maxQuantity, 30)
  assert.equal(main!.orderpoints[0]!.available, main!.available)
  assert.deepEqual(second!.orderpoints, [])
  assert.equal(second!.onHand, 0)
  assert.equal(facts.totals.onHand, 10)
  assert.equal(facts.variants['goods-1'], main!.available)

  const issues = productIssues({ saleOk: true, active: true, stock: facts, margin: null, variants: [] })
  assert.deepEqual(issues, [
    {
      code: 'belowMinimum',
      tone: 'warning',
      params: { warehouse: 'Kho chính', available: main!.available, minimum: 12, others: 0 },
    },
  ])
  // A product nobody can buy now is the first thing to fix, ahead of its rules.
  await adjust(adapter, 'count-0', '0')
  const empty = await workspace(adapter)
  assert.equal(
    productIssues({ saleOk: true, active: true, stock: empty, margin: null, variants: [] })[0]?.code,
    'outOfStock',
  )
  assert.equal(
    productIssues({ saleOk: false, active: true, stock: empty, margin: null, variants: [] })[0]?.code,
    'belowMinimum',
  )
})

test('product workspace: min/max rules are checked as a whole before any is written, then kept per warehouse', async (t) => {
  const adapter = await boot(t)
  const count = async () => (await adapter.all('SELECT * FROM stock_orderpoint')).length

  const refused = (await levels(adapter, [
    { productId: 'goods-1', minQuantity: '5', maxQuantity: '2' },
    { productId: 'other', minQuantity: '1', maxQuantity: '2' },
  ])) as unknown as Refusal
  assert.equal(refused.ok, false)
  assert.deepEqual(refused.errors, [
    { field: 'rules.0.maxQuantity', code: 'stock.error.orderpoint.range' },
    { field: 'rules.1.productId', code: 'stock.error.orderpoint.product' },
  ])
  const malformed = (await levels(adapter, [
    { productId: 'goods-1', minQuantity: '1,5', maxQuantity: '-2' },
  ])) as unknown as Refusal
  assert.deepEqual(
    malformed.errors.map((issue) => issue.field),
    ['rules.0.minQuantity', 'rules.0.maxQuantity'],
  )
  assert.equal(
    (
      (await levels(
        adapter,
        [{ productId: 'goods-1', minQuantity: '1', maxQuantity: '2' }],
        'nowhere',
      )) as unknown as Refusal
    ).errors[0]!.code,
    'stock.error.orderpoint.warehouse',
  )
  const mixed = (await levels(adapter, [
    { productId: 'goods-1', minQuantity: '5', maxQuantity: '10' },
    { productId: 'goods-1', minQuantity: '1', maxQuantity: '2' },
  ])) as unknown as Refusal
  assert.deepEqual(mixed.errors, [{ field: 'rules.1.productId', code: 'stock.error.orderpoint.product' }])
  assert.equal(await count(), 0, 'nothing is written while any row is refused')

  // One of the two alone: a minimum is its own maximum; a maximum starts from zero.
  await levels(adapter, [{ productId: 'goods-1', minQuantity: '5', maxQuantity: '' }])
  await levels(adapter, [{ productId: 'goods-1', minQuantity: '', maxQuantity: '8' }], 'wh2')
  const [main, second] = (await workspace(adapter)).warehouses
  assert.deepEqual([main!.orderpoints[0]!.minQuantity, main!.orderpoints[0]!.maxQuantity], [5, 5])
  assert.deepEqual([second!.orderpoints[0]!.minQuantity, second!.orderpoints[0]!.maxQuantity], [0, 8])
  const ruleId = main!.orderpoints[0]!.id

  // Saving again changes the same rule; clearing both switches it off, and it comes back as itself.
  await levels(adapter, [{ productId: 'goods-1', minQuantity: '2.5', maxQuantity: '10' }])
  assert.equal(await count(), 2)
  assert.deepEqual(await levels(adapter, [{ productId: 'goods-1', minQuantity: '', maxQuantity: '' }]), {
    ok: true,
    saved: 0,
    cleared: 1,
  })
  assert.deepEqual((await workspace(adapter)).warehouses[0]!.orderpoints, [])
  assert.equal(
    (await workspace(adapter)).warehouses[1]!.orderpoints.length,
    1,
    'the other warehouse keeps its rule',
  )
  await levels(adapter, [{ productId: 'goods-1', minQuantity: '3', maxQuantity: '9' }])
  const back = (await workspace(adapter)).warehouses[0]!.orderpoints
  assert.deepEqual(
    back.map((rule) => [rule.id, rule.minQuantity, rule.maxQuantity]),
    [[ruleId, 3, 9]],
  )
  const row = (await adapter.all('SELECT * FROM stock_orderpoint WHERE id = ?', [ruleId]))[0] as Row
  assert.equal(row.replenishmentUomId, 'unit', 'rules replenish in the product unit')
})

test('product workspace: sales count confirmed orders of the window, in the product unit', async (t) => {
  const adapter = await boot(t)
  await adjust(adapter, 'count', '100')
  await order(adapter, 'so-units', [['2', 'unit', '100']])
  await order(adapter, 'so-box', [['1', 'box', '540']])
  await order(adapter, 'so-draft', [['5', 'unit', '100']], false)
  await order(adapter, 'so-old', [['3', 'unit', '100']])
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
  await adapter.run('UPDATE sale_order SET "dateOrder" = ? WHERE id = ?', [old, 'so-old'])

  type Sales = { days: number; quantity: number; revenue: number; orders: number; lastAt: string | null }
  const month = await call<Sales>('sale.productSales', { templateId: 'goods', days: 30 }, adapter)
  assert.equal(month.days, 30)
  assert.equal(month.quantity, 8, 'a box of 6 counts as 6 bottles')
  assert.equal(month.orders, 2)
  assert.equal(month.revenue, 740)
  assert.ok(month.lastAt)
  const quarter = await call<Sales>('sale.productSales', { templateId: 'goods', days: 90 }, adapter)
  assert.equal(quarter.quantity, 11)
  assert.equal(quarter.orders, 3)
  assert.equal(
    (await call<Sales>('sale.productSales', { templateId: 'goods', days: 9000 }, adapter)).days,
    365,
  )
  assert.equal(await call('sale.productSales', { templateId: 'missing' }, adapter), null)
})

test('product workspace: vendor prices valid today, the preferred first', async (t) => {
  const adapter = await boot(t)
  await call('partner.savePartner', { id: 'vendor-a', kind: 'company', name: 'Vendor A' }, adapter)
  await call('partner.savePartner', { id: 'vendor-b', kind: 'company', name: 'Vendor B' }, adapter)
  const day = 86_400_000
  const price = (id: string, partnerId: string, values: Record<string, unknown>) =>
    call(
      'purchase.saveSupplierInfo',
      {
        id,
        partnerId,
        productTemplateId: 'goods',
        productUomId: 'unit',
        minQty: '0',
        price: '50',
        discount: '0',
        delay: 1,
        ...values,
      },
      adapter,
    )
  await price('later', 'vendor-a', { sequence: 5, price: '10' })
  await price('dear', 'vendor-a', { sequence: 1, price: '90', productCode: 'VA-1' })
  await price('cheap', 'vendor-b', { sequence: 1, price: '80' })
  await price('expired', 'vendor-b', { sequence: 0, dateEnd: new Date(Date.now() - day).toISOString() })
  await price('upcoming', 'vendor-b', { sequence: 0, dateStart: new Date(Date.now() + day).toISOString() })

  type Vendor = { id: string; vendor: string; vendorCode: string | null; price: string }
  const rows = await call<Vendor[]>('purchase.listProductVendors', { templateId: 'goods' }, adapter)
  assert.deepEqual(
    rows.map((row) => row.id),
    ['cheap', 'dear', 'later'],
  )
  assert.equal(rows[0]!.vendor, 'Vendor B')
  assert.equal(rows[1]!.vendorCode, 'VA-1')
  assert.deepEqual(
    await call('purchase.listProductVendors', { templateId: 'goods' }, adapter, {
      company: 'globex',
      branches: null,
    }),
    [],
  )
})

test('product workspace: configuring attributes writes attributes, values and variants together, or nothing', async (t) => {
  const adapter = await boot(t)
  await call(
    'product.saveTemplate',
    { id: 'shirt', name: 'Áo', type: 'goods', uomId: 'unit', listPrice: '100' },
    adapter,
  )
  const variants = async () =>
    (await adapter.all('SELECT * FROM product_product WHERE "templateId" = ? ORDER BY id', [
      'shirt',
    ])) as Row[]
  const table = async (name: string) => (await adapter.all(`SELECT * FROM ${name}`)).length
  const before = await variants()
  assert.equal(before.length, 1)

  type Applied = {
    ok: true
    created: { attributes: Record<string, string>; values: Record<string, string> }
    variants: number
    createdVariants: number
    archivedVariants: number
  }
  const first = await call<Applied>(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: [
        {
          name: 'Size',
          values: [
            { name: 'S', priceExtra: '0' },
            { name: 'M', priceExtra: '10' },
          ],
        },
      ],
    },
    adapter,
  )
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.variants, 2)
  const size = first.created.attributes['0']!
  const [small, medium] = [first.created.values['0.0']!, first.created.values['0.1']!]
  assert.ok(size && small && medium)
  const active = async () => (await variants()).filter((row) => Boolean(row.active))
  assert.equal((await active()).length, 2)
  const own = (await variants()).find((row) => row.id === before[0]!.id)!
  assert.equal(Boolean(own.active), false, 'the product\u2019s own variant rests while variants sell')

  // A value added to the line makes one more variant.
  const sizes = [
    { valueId: small, priceExtra: '0' },
    { valueId: medium, priceExtra: '10' },
  ]
  const extended = await call<Applied>(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: [{ attributeId: size, values: [...sizes, { name: 'L', priceExtra: '20' }] }],
    },
    adapter,
  )
  assert.equal(extended.createdVariants, 1)
  const large = extended.created.values['0.2']!
  const sized = (await active()).map((row) => String(row.id)).sort()
  assert.equal(sized.length, 3)

  // A new attribute extends the variants there are with its first value, ids and all.
  const allSizes = [...sizes, { valueId: large, priceExtra: '20' }]
  const colored = await call<Applied>(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: [
        { attributeId: size, values: allSizes },
        {
          name: 'Màu',
          values: [
            { name: 'Đỏ', priceExtra: '0' },
            { name: 'Xanh', priceExtra: '5' },
          ],
        },
      ],
    },
    adapter,
  )
  assert.deepEqual(
    [colored.ok, colored.variants, colored.createdVariants, colored.archivedVariants],
    [true, 6, 3, 0],
  )
  const red = colored.created.values['1.0']!
  for (const id of sized) {
    const values = await adapter.all(
      'SELECT "templateAttributeValueId" AS value FROM product_product_value WHERE "productId" = ?',
      [id],
    )
    assert.ok(
      values.some((row) => String(row.value).endsWith(`:${red}`)),
      `${id} keeps its id as the red one`,
    )
  }

  // Applying the same setup again changes nothing.
  const again = await call<Applied>(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: [
        { attributeId: size, values: allSizes },
        {
          attributeId: colored.created.attributes['1']!,
          values: [
            { valueId: red, priceExtra: '0' },
            { valueId: colored.created.values['1.1']!, priceExtra: '5' },
          ],
        },
      ],
    },
    adapter,
  )
  assert.deepEqual([again.ok, again.variants, again.createdVariants, again.archivedVariants], [true, 6, 0, 0])

  // A refused apply leaves no attribute, value or variant behind.
  const counts = async () => [
    await table('product_attribute'),
    await table('product_attribute_value'),
    (await variants()).length,
  ]
  const kept = await counts()
  const duplicate = (await call(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: [
        { attributeId: size, values: [{ valueId: small, priceExtra: '0' }] },
        { name: 'Chất liệu', values: [{ name: 'Cotton', priceExtra: '0' }] },
        { name: 'size', values: [{ name: 'XL', priceExtra: '0' }] },
      ],
    },
    adapter,
  )) as unknown as Refusal
  assert.equal(duplicate.ok, false)
  assert.deepEqual(duplicate.errors[0], {
    field: 'lines.2.name',
    code: 'product.error.configure.attributeExists',
    params: { name: 'Size' },
  })
  const tooMany = (await call(
    'product.configureAttributes',
    {
      templateId: 'shirt',
      lines: ['A', 'B', 'C'].map((name) => ({
        name,
        values: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `${name}${n}`, priceExtra: '0' })),
      })),
    },
    adapter,
  )) as unknown as Refusal
  assert.equal(tooMany.errors[0]!.code, 'product.error.configure.tooMany')
  const extra = (await call(
    'product.configureAttributes',
    { templateId: 'shirt', lines: [{ name: 'Chất liệu', values: [{ name: 'Cotton', priceExtra: 'abc' }] }] },
    adapter,
  )) as unknown as Refusal
  assert.deepEqual(extra.errors, [
    { field: 'lines.0.values.0.priceExtra', code: 'product.error.configure.extra' },
  ])
  assert.deepEqual(await counts(), kept)
})

test('product workspace: duplicating copies the template’s information, never what identifies one product', async (t) => {
  const adapter = await boot(t)
  await call(
    'product.saveTemplate',
    {
      id: 'goods',
      name: 'Serum',
      type: 'goods',
      uomId: 'unit',
      listPrice: '250',
      compareAtPrice: '300',
      description: 'Dưỡng ẩm',
      saleOk: true,
      defaultCode: 'SR-01',
      barcode: '8930000000011',
    },
    adapter,
  )
  const copy = await call<Row>(
    'product.duplicateTemplate',
    { id: 'copy', sourceId: 'goods', name: 'Serum (bản sao)' },
    adapter,
  )
  assert.equal(copy.ok, true, JSON.stringify(copy))
  const row = (await adapter.all('SELECT * FROM product_template WHERE id = ?', ['copy']))[0] as Row
  assert.equal(row.name, 'Serum (bản sao)')
  assert.equal(Number(row.listPrice), 250)
  assert.equal(Number(row.compareAtPrice), 300)
  assert.equal(row.description, 'Dưỡng ẩm')
  const variant = (await adapter.all('SELECT * FROM product_product WHERE "templateId" = ?', [
    'copy',
  ])) as Row[]
  assert.equal(variant.length, 1)
  assert.equal(variant[0]!.defaultCode ?? null, null)
  assert.equal(variant[0]!.barcode ?? null, null)
  assert.equal(
    (
      (await call(
        'product.duplicateTemplate',
        { id: 'copy', sourceId: 'goods' },
        adapter,
      )) as unknown as Refusal
    ).errors[0]!.code,
    'product.error.duplicate.taken',
  )
  assert.equal(
    (
      (await call(
        'product.duplicateTemplate',
        { id: 'copy-2', sourceId: 'gone' },
        adapter,
      )) as unknown as Refusal
    ).errors[0]!.code,
    'product.error.duplicate.missing',
  )
})

test('product workspace: margin and completeness from the saved product', () => {
  const record = {
    id: 't',
    name: 'T',
    type: 'goods',
    listPrice: '200',
    saleOk: true,
    active: true,
    isStorable: true,
    costPrice: '150',
    defaultVariantId: 't:default',
  }
  assert.deepEqual(productMargin({ record, variants: [], hasVariants: false }), { profit: 50, percent: 25 })
  assert.equal(
    productMargin({ record: { ...record, saleOk: false }, variants: [], hasVariants: false }),
    null,
  )
  assert.equal(
    productMargin({ record: { ...record, listPrice: '0' }, variants: [], hasVariants: false }),
    null,
  )
  assert.equal(
    productMargin({ record: { ...record, costPrice: null }, variants: [], hasVariants: false }),
    null,
  )
  const variant = (id: string, price: string, costPrice: string | null, active = true) => ({
    id,
    label: id,
    barcode: null,
    defaultCode: id,
    active,
    price,
    costPrice,
  })
  // Over the selling variants whose cost is known.
  assert.deepEqual(
    productMargin({
      record,
      hasVariants: true,
      variants: [
        variant('a', '100', '80'),
        variant('b', '300', '120'),
        variant('c', '500', null),
        variant('d', '900', '0', false),
      ],
    }),
    { profit: 100, percent: 50 },
  )
  const base = {
    record: { ...record, description: 'x', defaultCode: 'T', barcode: null, categoryId: 'c', weight: '0' },
    images: [],
    variants: [],
    hasVariants: false,
    permissions: {},
  }
  const seen = productCompleteness(base, true)
  assert.deepEqual(
    seen.items.map((item) => item.key),
    ['image', 'description', 'defaultCode', 'barcode', 'categoryId', 'costPrice', 'weight'],
  )
  assert.equal(seen.score, Math.round((4 / 7) * 100))
  assert.ok(
    !productCompleteness(base, false).items.some((item) => item.key === 'costPrice'),
    'costs count only for who may see them',
  )
  assert.ok(
    !productCompleteness({ ...base, record: { ...base.record, type: 'service' } }, true).items.some(
      (item) => item.key === 'weight',
    ),
  )
})

test('product workspace HTTP: the page reads what the viewer may see from the modules composed', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  for (const [id, superuser] of [
    ['admin', true],
    ['reader', false],
    ['nobody', false],
  ] as const) {
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'correct horse',
      name: id,
      defaultCompanyId: 'acme',
      superuser,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  await fixture('user.saveRole', { id: 'catalog-reader', name: 'Catalog reader' })
  for (const fnKey of [
    'product.templateModalContext',
    'product.getTemplate',
    'sale.productSales',
    'purchase.listProductVendors',
  ])
    await fixture('user.grantFunction', { id: `catalog-reader:${fnKey}`, roleId: 'catalog-reader', fnKey })
  await fixture('user.assignRole', {
    id: 'reader:catalog-reader',
    userId: 'reader',
    roleId: 'catalog-reader',
  })

  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' })
  await app.client.call('product.saveTemplate', {
    id: 'goods',
    name: 'Serum',
    type: 'goods',
    uomId: 'unit',
    listPrice: '200',
    saleOk: true,
  })
  await app.client.call('product.setCost', { productId: 'goods:default', standardPrice: '250' })
  await app.client.call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await app.client.call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await app.client.call('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor A' })
  await app.client.call('purchase.saveSupplierInfo', {
    id: 'vendor:goods',
    partnerId: 'vendor',
    productTemplateId: 'goods',
    productUomId: 'unit',
    minQty: '0',
    price: '120',
    discount: '0',
    delay: 2,
  })

  type Page = {
    data: Row & { record: Row; permissions: Record<string, boolean>; links: Record<string, string | null> }
    messages: Record<string, string>
  }
  const page = async (client = app.client, path = '/admin/product/templates/goods/context?lang=vi') => {
    const response = await client.get(path)
    return {
      status: response.status,
      body: response.status === 200 ? ((await response.json()) as Page) : null,
    }
  }

  const admin = (await page()).body!
  const stockFacts = admin.data.stock as Stock
  assert.equal(stockFacts.tracked, true)
  assert.deepEqual(admin.data.sales, { days: 30, quantity: 0, revenue: 0, orders: 0, lastAt: null })
  assert.deepEqual(
    (admin.data.vendors as Array<{ vendor: string; price: string | null }>).map((row) => [
      row.vendor,
      Number(row.price),
    ]),
    [['Vendor A', 120]],
  )
  assert.deepEqual(admin.data.margin, { profit: -50, percent: -25 })
  assert.deepEqual(
    (admin.data.issues as Array<{ code: string }>).map((issue) => issue.code),
    ['outOfStock', 'belowCost'],
  )
  assert.equal(admin.data.permissions.orderpoints, true)
  assert.equal(admin.data.uomLocked, false, 'no stock yet, so the unit may still change')
  assert.equal(admin.data.links.forecast, '/admin/stock/forecast?productId=goods%3Adefault&lang=vi')
  assert.ok(admin.messages['stock.error.orderpoint.range'], 'the min/max refusals are worded on the page')

  // The page carries its own guide, opened from the rail, in the reader's language.
  for (const [lang, title, trigger] of [
    ['vi', 'Trang sản phẩm', 'Hướng dẫn màn hình'],
    ['en', 'Product page', 'Screen help'],
  ] as const) {
    const html = await (await app.client.get(`/admin/product/templates/goods?lang=${lang}`)).text()
    assert.match(html, /<[^>]+id="product-template-help"/)
    assert.ok(html.includes(title), `${lang} guide title`)
    assert.ok(html.includes(trigger), `${lang} rail help label`)
    assert.match(html, /language-mermaid|data-mermaid|mermaid/u, `${lang} guide keeps its diagram`)
    assert.equal((html.match(/id="product-template-help"/gu) ?? []).length, 1, 'one guide per page')
  }

  const reader = app.client.anonymous()
  await reader.login({ login: 'reader', password: 'correct horse' })
  const read = (await page(reader)).body!
  for (const key of ['stock', 'margin']) assert.equal(read.data[key], null, `${key} needs its own right`)
  // Who may read sales and vendors without costs sees how many and from whom, not how much.
  assert.deepEqual(read.data.sales, { days: 30, quantity: 0, revenue: null, orders: 0, lastAt: null })
  assert.deepEqual(
    (read.data.vendors as Array<{ vendor: string; price: string | null }>).map((row) => [
      row.vendor,
      row.price,
    ]),
    [['Vendor A', null]],
  )
  assert.deepEqual(read.data.issues, [])
  assert.equal(read.data.permissions.orderpoints, false)
  assert.equal(read.data.permissions.money, false)
  assert.equal(read.data.links.forecast, null)
  assert.ok(
    !(read.data.completeness as { items: Array<{ key: string }> }).items.some(
      (item) => item.key === 'costPrice',
    ),
  )

  const nobody = app.client.anonymous()
  await nobody.login({ login: 'nobody', password: 'correct horse' })
  assert.equal((await page(nobody)).status, 403)
  assert.equal(
    (await page(reader, '/admin/product/templates/new/context')).status,
    403,
    'reading is not creating',
  )
  assert.equal((await page(app.client, '/admin/product/templates/missing/context')).status, 404)
  const posted = await app.client.post('/admin/product/templates/goods/context', '', { redirect: 'manual' })
  assert.equal(posted.status, 405)
})
