// The product list's one paged read (product_backend/list/read.ts): what it applies,
// clamps and counts, and what stock adds when stock answers the list.

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import type { Row } from '@ketvietlab/ketjs'
import type {
  ProductListAnswer,
  ProductListGroup,
  ProductListRow,
} from '../packages/ketsuite/src/modules/product_backend/list/read.ts'

const scope = { company: 'acme', companies: ['acme'], branch: 'root:acme', branches: ['root:acme'] }

const boot = async (t: TestContext, seed = true) => {
  const booted = await bootDeployment(ketsuite, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'product-list-read' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const run = async <T>(fn: string, args: Record<string, unknown> = {}, actor: string | null = 'root') => {
    const result = await callFn(fn, args, {
      adapter: booted.adapter!,
      manifest: booted.manifest,
      scope,
      actor,
    })
    return result.value as T
  }
  await run('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, null)
  await run('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, null)
  await run('user.createUser', { id: 'root', login: 'root', name: 'Root', superuser: true }, null)
  // "clerk" reads the catalogue but not what anything costs.
  await run('user.createUser', { id: 'clerk', login: 'clerk', name: 'Clerk' }, null)
  await run('user.grantCompany', { id: 'clerk:acme', userId: 'clerk', companyId: 'acme' })
  await run('user.saveRole', { id: 'catalogue', name: 'Catalogue' })
  for (const fnKey of ['product_backend.searchTemplates', 'stock_backend.searchProductTemplates'])
    await run('user.grantFunction', { id: `catalogue:${fnKey}`, roleId: 'catalogue', fnKey })
  await run('user.assignRole', { id: 'clerk:catalogue', userId: 'clerk', roleId: 'catalogue' })
  if (!seed) return run

  await run('uom.saveUnit', { id: 'unit', name: 'Chai', relativeFactor: '1' })
  await run('product.saveCategory', { id: 'skin', name: 'Chăm sóc da' })
  const template = async (id: string, fields: Record<string, unknown>) => {
    const saved = await run<{ ok?: boolean }>('product.saveTemplate', {
      id,
      type: 'goods',
      uomId: 'unit',
      saleOk: true,
      purchaseOk: true,
      ...fields,
    })
    assert.notEqual(saved.ok, false, `${id}: ${JSON.stringify(saved)}`)
  }
  await template('serum', {
    name: 'Serum B5',
    listPrice: '100',
    categoryId: 'skin',
    defaultCode: 'SR-1',
    barcode: '8931234567897',
  })
  await template('mask', { name: 'Mặt nạ đất sét', listPrice: '50', categoryId: 'skin', defaultCode: 'MK-1' })
  await template('massage', { name: 'Liệu trình massage', type: 'service', listPrice: '300' })
  // First letters in ASCII, so the order is the same under any collation.
  await template('tee', { name: 'Thun cotton', listPrice: '200' })
  await template('old', { name: 'Kem cũ', listPrice: '80' })
  const old = await run<{ revisionId: string }>('product.getTemplate', { id: 'old' })
  await run('product.archiveTemplate', {
    id: 'old',
    active: false,
    reason: 'Discontinued',
    expectedRevisionId: old.revisionId,
    confirmed: true,
  })
  const sizes = await run<{ ok: boolean }>('product.configureAttributes', {
    templateId: 'tee',
    lines: [
      {
        name: 'Size',
        values: [
          { name: 'S', priceExtra: '0' },
          { name: 'M', priceExtra: '100' },
        ],
      },
    ],
  })
  assert.equal(sizes.ok, true, JSON.stringify(sizes))
  await run('product.setCost', { productId: 'serum:default', standardPrice: '60' })
  // The original SKU became the first size, so every size carries a cost.
  for (const variant of await run<Array<{ id: string }>>('product.listVariants', { templateId: 'tee' }))
    await run('product.setCost', { productId: variant.id, standardPrice: '150' })

  for (const id of ['serum', 'mask'])
    await run('stock.configureProduct', { templateId: id, isStorable: true, tracking: 'none' })
  await run('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await run('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await run('stock.adjustInventory', {
    id: 'count',
    productId: 'serum:default',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  return run
}

type Run = Awaited<ReturnType<typeof boot>>
const list = (run: Run, href: string, options: { actor?: string; pageSize?: number; stock?: boolean } = {}) =>
  run<ProductListAnswer>(
    options.stock === false ? 'product_backend.searchTemplates' : 'stock_backend.searchProductTemplates',
    { href, ...(options.pageSize ? { pageSize: options.pageSize } : {}) },
    options.actor ?? 'root',
  )
const names = (answer: ProductListAnswer) => answer.rows.map((row) => row.id)
const param = (href: string | null, name: string) =>
  href === null ? null : new URL(href, 'http://ket.local').searchParams.get(name)

test('product list read: a bare list shows active templates by name, counts each preset, and says it is not empty', async (t) => {
  const run = await boot(t)
  const answer = await list(run, '/admin/product/templates?lang=vi', { stock: false })
  assert.deepEqual(names(answer), ['massage', 'mask', 'serum', 'tee'], 'archived "old" is left out')
  assert.deepEqual(answer.query.sort, [{ key: 'name', dir: 'asc' }])
  assert.equal(answer.total, 4)
  assert.deepEqual([answer.page, answer.pages, answer.previous, answer.next], [1, 1, null, null])
  assert.deepEqual(answer.counts, {
    goods: 3,
    service: 1,
    combo: 0,
    sale: 4,
    purchase: 4,
    notSold: 0,
    tracked: 0,
  })
  // A preset's count ignores its own group's choice and applies the others'.
  const goods = await list(run, '/admin/product/templates?preset=goods', { stock: false })
  assert.deepEqual(
    [goods.total, goods.counts],
    [3, { goods: 3, service: 1, combo: 0, sale: 3, purchase: 3, notSold: 0, tracked: 0 }],
  )
  assert.equal(answer.isEmpty, false)
  // Without stock answering there is no stock figure at all, not a zero.
  assert.equal(answer.stock, false)
  assert.ok(answer.rows.every((row) => row.available === null))
  // Every link keeps the reader's other parameters (the language).
  assert.equal(param(answer.sort.name!, 'lang'), 'vi')
  assert.equal(param(answer.sort.name!, 'sort'), 'name:desc', 'the current column turns around')
  assert.equal(param(answer.sort.listPrice!, 'sort'), 'listPrice:asc')
  const serum = answer.rows.find((row) => row.id === 'serum')!
  assert.deepEqual(
    {
      code: serum.code,
      category: serum.category,
      unit: serum.unit,
      variants: serum.variants,
      margin: serum.margin,
    },
    { code: 'SR-1', category: 'Chăm sóc da', unit: 'Chai', variants: 0, margin: 40 },
  )
  // The margin of a template with variants is over its selling variants: (200−150 + 300−150) / 2 over 250.
  assert.deepEqual(
    {
      variants: answer.rows.find((row) => row.id === 'tee')!.variants,
      margin: answer.rows.find((row) => row.id === 'tee')!.margin,
    },
    { variants: 2, margin: 40 },
  )
  assert.equal(answer.rows.find((row) => row.id === 'massage')!.margin, null, 'no cost, no margin')
})

test('product list read: search covers variant codes and barcodes; a page past the end is clamped', async (t) => {
  const run = await boot(t)
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=SR-1')), ['serum'])
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=8931234567897')), ['serum'])
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=mặt')), ['mask'])
  const none = await list(run, '/admin/product/templates?q=zzz')
  assert.deepEqual([none.total, none.isEmpty], [0, false], 'nothing matches, but products exist')

  const late = await list(run, '/admin/product/templates?page=9&lang=en', { pageSize: 3 })
  assert.deepEqual([late.page, late.pages, late.query.page], [2, 2, 2])
  assert.equal(param(late.href, 'page'), '2')
  assert.equal(param(late.href, 'lang'), 'en')
  assert.deepEqual(names(late), ['tee'])
  assert.equal(param(late.previous, 'page'), null, 'page 1 is the default, so it is left out')
  assert.equal(late.next, null)
  // A modal over the list is not the list's state.
  const overlaid = await list(run, '/admin/product/templates?modal=favorite&bulkError=delete')
  assert.equal(param(overlaid.href, 'modal'), null)
  assert.equal(param(overlaid.sort.name!, 'bulkError'), null)
  // Another path cannot be read through this list.
  assert.equal(
    new URL((await list(run, '/admin/users?q=x')).href, 'http://ket.local').pathname,
    '/admin/product/templates',
  )
})

test('product list read: stock adds what can be sold, its sort and the out-of-stock preset', async (t) => {
  const run = await boot(t)
  const answer = await list(run, '/admin/product/templates')
  assert.equal(answer.stock, true)
  const available = Object.fromEntries(answer.rows.map((row) => [row.id, row.available]))
  assert.deepEqual(available, { tee: null, massage: null, mask: 0, serum: 10 })
  assert.equal(answer.counts.outOfStock, 1)
  assert.deepEqual(names(await list(run, '/admin/product/templates?preset=outOfStock')), ['mask'])
  // Untracked products have no figure to order by; they come last either way.
  assert.deepEqual(names(await list(run, '/admin/product/templates?sort=available:desc')), [
    'serum',
    'mask',
    'massage',
    'tee',
  ])
  assert.deepEqual(names(await list(run, '/admin/product/templates?sort=available:asc')), [
    'mask',
    'serum',
    'massage',
    'tee',
  ])
  // The product read does not know the preset; an old link with it shows the catalogue.
  const plain = await list(run, '/admin/product/templates?preset=outOfStock', { stock: false })
  assert.deepEqual(plain.query.presets, [])
  assert.equal(plain.total, 4)
})

test('product list read: a role without costs sees no margin; the answer names the reader saved searches', async (t) => {
  const run = await boot(t)
  const answer = await list(run, '/admin/product/templates', { actor: 'clerk' })
  assert.equal(answer.money, false)
  assert.ok(answer.rows.every((row) => row.margin === null))
  const saved = await run<{ id: string }>(
    'product_backend.saveSearchFavorite',
    {
      name: 'Dịch vụ',
      state: {
        listKey: 'product.templates',
        returnTo: '/admin/product/templates',
        facets: [{ id: 'preset:service', type: 'filter', label: 'Dịch vụ' }],
      },
    },
    'root',
  )
  const mine = await list(run, '/admin/product/templates')
  assert.deepEqual(
    mine.favorites.map(({ id, name, isDefault, owned, shared, active }) => ({
      id,
      name,
      isDefault,
      owned,
      shared,
      active,
    })),
    [{ id: saved.id, name: 'Dịch vụ', isDefault: false, owned: true, shared: false, active: false }],
  )
  assert.deepEqual(
    (await list(run, '/admin/product/templates', { actor: 'clerk' })).favorites,
    [],
    'saved searches are personal',
  )
})

test('product list read: groups carry their names, counts and the links that open them and page them', async (t) => {
  const run = await boot(t)
  const grouped = await list(run, '/admin/product/templates?group=categoryId', { pageSize: 1 })
  assert.equal(grouped.total, 4)
  assert.deepEqual(grouped.rows, [], 'a grouped list shows its rows inside groups')
  const byValue = (groups: ProductListGroup[] | null) =>
    Object.fromEntries((groups ?? []).map((group) => [String(group.value), group]))
  const closed = byValue(grouped.groups)
  assert.deepEqual(
    // Where empty keys sort is the database's choice; compare by value.
    Object.values(closed)
      .sort((a, b) => String(a.value).localeCompare(String(b.value)))
      .map((group) => [group.value, group.name, group.count, group.open]),
    [
      [null, null, 2, false],
      ['skin', 'Chăm sóc da', 2, false],
    ],
  )
  const opened = byValue((await list(run, closed.skin!.href, { pageSize: 1 })).groups)
  assert.equal(opened.skin!.open, true)
  assert.deepEqual(
    opened.skin!.rows!.map((row) => row.id),
    ['mask'],
  )
  assert.deepEqual([opened.skin!.pager!.from, opened.skin!.pager!.to, opened.skin!.pager!.total], [1, 1, 2])
  const next = byValue((await list(run, opened.skin!.pager!.next!, { pageSize: 1 })).groups)
  assert.deepEqual(
    next.skin!.rows!.map((row) => row.id),
    ['serum'],
  )
  assert.equal(
    byValue((await list(run, next.skin!.href, { pageSize: 1 })).groups).skin!.open,
    false,
    'the toggle closes it again',
  )
})

test('product list read: an empty catalogue says so, apart from a search that matches nothing', async (t) => {
  const run = await boot(t, false)
  const answer = await list(run, '/admin/product/templates')
  assert.deepEqual([answer.total, answer.isEmpty, answer.rows.length], [0, true, 0])
  assert.deepEqual(answer.counts, {
    goods: 0,
    service: 0,
    combo: 0,
    sale: 0,
    purchase: 0,
    outOfStock: 0,
    notSold: 0,
    tracked: 0,
  })
})

test('product list read: a product priced by variant shows where it starts, own prices included (P12)', async (t) => {
  const run = await boot(t)
  const row = async (id: string) =>
    (await list(run, '/admin/product/templates', { stock: false })).rows.find((entry) => entry.id === id)!
  const priced = (entry: ProductListRow) => [entry.fromPrice, entry.priceVaries, entry.margin]
  // S sells at the list price, M at the list price plus its extra: the product starts at 200.
  assert.deepEqual(priced(await row('tee')), ['200', true, 40])
  assert.deepEqual(priced(await row('serum')), ['100', false, 40])

  const setup = async () =>
    (await run<{ data: Row }>('product.templateModalContext', { id: 'tee', locale: 'en' })).data
      .variantSetup as { lines: Row[]; variants: Row[] }
  const ownPrice = async (listPrice: string) => {
    const current = await setup()
    const saved = await run<{ ok?: boolean }>('product.saveVariantSetup', {
      templateId: 'tee',
      lines: current.lines,
      variants: current.variants.map((variant) =>
        variant.id === 'tee:default' ? variant : { ...variant, listPrice },
      ),
    })
    assert.notEqual(saved.ok, false, JSON.stringify(saved))
  }
  // M's own price replaces list price plus extra, in the starting price and in the margin.
  await ownPrice('150')
  assert.deepEqual(priced(await row('tee')), ['150', true, 14.3])
  // Every size at one price shows that price alone.
  await ownPrice('200')
  assert.deepEqual(priced(await row('tee')), ['200', false, 25])
})

test('product list read: the price column sorts by where each product starts, not its list price (P12)', async (t) => {
  const run = await boot(t)
  const current = (await run<{ data: Row }>('product.templateModalContext', { id: 'tee', locale: 'en' })).data
    .variantSetup as { lines: Row[]; variants: Row[] }
  // Every size sells for 40 of its own: the list price stays 200, the product starts at 40.
  const saved = await run<{ ok?: boolean }>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: current.lines,
    variants: current.variants.map((variant) =>
      variant.id === 'tee:default' ? variant : { ...variant, listPrice: '40' },
    ),
  })
  assert.notEqual(saved.ok, false, JSON.stringify(saved))

  for (const stock of [false, true]) {
    const bare = await list(run, '/admin/product/templates', { stock })
    const ascending = await list(run, bare.sort.listPrice!, { stock })
    assert.deepEqual(ascending.query.sort, [{ key: 'listPrice', dir: 'asc' }])
    assert.deepEqual(names(ascending), ['tee', 'mask', 'serum', 'massage'], `stock ${stock}: by From price`)
    assert.deepEqual(
      ascending.rows.map((row) => row.fromPrice),
      ['40', '50', '100', '300'],
    )
    const descending = await list(run, ascending.sort.listPrice!, { stock })
    assert.deepEqual(names(descending), ['massage', 'serum', 'mask', 'tee'], `stock ${stock}: turned around`)
    // Pages cut the sorted whole, not each page's own rows.
    const second = await list(run, ascending.href, { stock, pageSize: 2 })
    const next = await list(run, second.next!, { stock, pageSize: 2 })
    assert.deepEqual(
      [names(second), names(next)],
      [
        ['tee', 'mask'],
        ['serum', 'massage'],
      ],
    )
  }
  // Inside a group the same order holds.
  const grouped = await list(run, '/admin/product/templates?group=type&sort=listPrice%3Aasc', {
    stock: false,
  })
  const goods = (grouped.groups ?? []).find((group) => group.value === 'goods')!
  const opened = (await list(run, goods.href, { stock: false })).groups!.find(
    (group) => group.value === 'goods',
  )!
  assert.deepEqual(
    opened.rows!.map((row) => row.id),
    ['tee', 'mask', 'serum'],
  )
})

test('product list read: a product keeps its own code once its original SKU becomes a combination', async (t) => {
  const run = await boot(t)
  const saved = await run<{ ok?: boolean }>('product.saveTemplate', {
    id: 'cap',
    name: 'Mũ',
    type: 'goods',
    uomId: 'unit',
    defaultCode: 'CAP',
  })
  assert.notEqual(saved.ok, false, JSON.stringify(saved))
  const colours = await run<{ ok?: boolean }>('product.configureAttributes', {
    templateId: 'cap',
    lines: [{ name: 'Màu', values: [{ name: 'Đỏ' }, { name: 'Xanh' }] }],
  })
  assert.notEqual(colours.ok, false, JSON.stringify(colours))
  const codes = (
    await run<Array<{ defaultCode: string | null }>>('product.listVariants', { templateId: 'cap' })
  ).map((variant) => variant.defaultCode)
  assert.ok(codes.includes('CAP') && codes.length === 2, codes.join())
  const row = (await list(run, '/admin/product/templates?q=CAP', { stock: false })).rows.find(
    (entry) => entry.id === 'cap',
  )
  assert.equal(row?.code, 'CAP')
})

test('product list read: search folds Vietnamese accents in names and descriptions (P12)', async (t) => {
  const run = await boot(t)
  // Production sorts with the C collation, where ilike folds ASCII only: "mat na" must still find "Mặt nạ".
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=mat%20na', { stock: false })), ['mask'])
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=M%E1%BA%B6T', { stock: false })), [
    'mask',
  ])
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=lieu%20trinh', { stock: false })), [
    'massage',
  ])
  // The archived product stays out unless asked for.
  assert.deepEqual(names(await list(run, '/admin/product/templates?q=kem%20cu', { stock: false })), [])
})

test('product list read: names sort as Vietnamese reads them, Á beside A and Đ after D (P12)', async (t) => {
  const run = await boot(t)
  // Databases order by bytes (production runs the C collation): Á, Đ and Ô would land after Z.
  const ours = ['vn-z', 'vn-o', 'vn-dd', 'vn-d', 'vn-a2', 'vn-a10', 'vn-aa']
  for (const [id, name] of [
    ['vn-z', 'Zest chanh'],
    ['vn-o', 'Ô mai mơ'],
    ['vn-dd', 'Đèn xông tinh dầu'],
    ['vn-d', 'Dầu gội'],
    ['vn-a2', 'Áo choàng 2'],
    ['vn-a10', 'Áo choàng 10'],
    ['vn-aa', 'An cung'],
  ])
    await run('product.saveTemplate', { id, name, type: 'goods', uomId: 'unit', listPrice: '10' })
  const order = (answer: ProductListAnswer) => names(answer).filter((id) => ours.includes(id))
  const expected = ['vn-aa', 'vn-a2', 'vn-a10', 'vn-d', 'vn-dd', 'vn-o', 'vn-z']
  for (const stock of [false, true]) {
    assert.deepEqual(order(await list(run, '/admin/product/templates', { pageSize: 100, stock })), expected)
    assert.deepEqual(
      order(await list(run, '/admin/product/templates?sort=name%3Adesc', { pageSize: 100, stock })),
      [...expected].reverse(),
    )
  }
  // A page holds the names that belong on it, not the first rows the database returned.
  const firstPage = await list(run, '/admin/product/templates?q=%C3%A1o%20cho%C3%A0ng', {
    pageSize: 1,
    stock: false,
  })
  assert.deepEqual(names(firstPage), ['vn-a2'])
  // The Variants list orders its SKUs the same way.
  const variants = await run<{ rows: Array<{ templateId: string }> }>('product_backend.searchVariants', {
    pageSize: 100,
  })
  assert.deepEqual(
    variants.rows.map((row) => row.templateId).filter((id) => ours.includes(id)),
    expected,
  )
  // Sorted by code, the SKUs without one come last either way.
  for (const dir of ['asc', 'desc']) {
    const coded = (
      await run<{ rows: Array<{ code: string | null }> }>('product_backend.searchVariants', {
        sort: 'code',
        dir,
        pageSize: 100,
      })
    ).rows.map((row) => row.code !== null)
    assert.ok(coded.includes(false) && coded.includes(true), dir)
    assert.equal(coded.indexOf(false), coded.lastIndexOf(true) + 1, dir)
  }
})
