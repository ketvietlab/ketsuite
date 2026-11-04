import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import type { RecordModalDefinition } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { shipmentDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/shipment-view.tsx'
import { deliveryStatementDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/delivery-statement-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { seed } from './fixtures/stock/delivery.ts'
import { validateInput } from './helpers/ketjs-internals.ts'

const html = (value: unknown) => renderToString(value as TemplateResult)
// Without the view's hydration markers, so text sits next to its tag.
const page = async (response: Response) => (await response.text()).replace(/<!--k\[?-->/g, '')

const shipmentContext = (record: Row, permissions: Partial<Record<string, boolean>>, extra: Row = {}) =>
  ({
    kind: 'stock.shipment',
    id: String(record.id ?? 'parcel'),
    creating: false,
    presentation: 'page',
    data: {
      record: {
        id: 'parcel',
        name: 'WH/VD/0001',
        state: 'draft',
        pickingOpen: true,
        ready: false,
        ...record,
      },
      lang: 'en',
      permissions: {
        save: false,
        book: false,
        handOver: false,
        deliver: false,
        fail: false,
        retry: false,
        return: false,
        cancel: false,
        ...permissions,
      },
      texts: {
        cod: '300,000 ₫',
        codLimit: '300,000 ₫',
        shippingFee: '20,000 ₫',
        codFee: '4,500 ₫',
        total: '24,500 ₫',
      },
      links: {
        picking: { name: 'WH/OUT/0001', href: '/admin/stock/transfers/order:delivery' },
        returnPicking: null,
        order: { name: 'S0001', href: null },
        statement: null,
        codEntry: null,
        list: '/admin/stock/shipments',
      },
      carriers: [{ id: 'ghn', name: 'Giao Hàng Nhanh' }],
      ...extra,
    },
    draft: (_key: string, fallback: string) => fallback,
    fieldError: () => undefined,
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    busy: false,
    recordChanged: false,
  }) as never

test('K46 a shipment offers each step in its state to whoever may take it', () => {
  const worker = {
    save: true,
    book: true,
    handOver: true,
    deliver: true,
    fail: true,
    retry: true,
    return: true,
    cancel: true,
  }
  const draft = shipmentContext({ carrierId: 'ghn', weight: '1', cod: '300000' }, worker)
  const actions = html(shipmentDefinition.pageActions!(draft))
  // Save and Book both submit the parcel's form; Book takes the tracking code typed there.
  assert.match(actions, /name="__command" value="save" form="stock-shipment-form"/)
  assert.match(actions, /name="__command" value="book" form="stock-shipment-form"/)
  assert.match(actions, /stock_backend\.shipment\.cancel/)
  const body = html(shipmentDefinition.body!(draft))
  // The carrier is a relation picker; weight, cash, tracking code and note are the parcel's fields.
  assert.match(body, /backend\.relation-select[\s\S]*shipment-carrierId/)
  for (const name of ['weight', 'cod', 'trackingCode', 'note'])
    assert.match(body, new RegExp(`shipment-${name}`))
  assert.match(body, /shipment\.quoteHelp/)
  assert.match(body, /24,500 ₫/)
  assert.match(
    shipmentDefinition.commands!.book!.confirm!(draft)!,
    /shipment\.bookMessage.*Giao Hàng Nhanh.*24,500 ₫.*300,000 ₫/,
  )
  // Unsaved edits change the fees, so the question then quotes no figures.
  assert.equal(
    shipmentDefinition.commands!.book!.confirm!({ ...(draft as object), recordChanged: true } as never),
    'stock_backend.shipment.bookChangedMessage',
  )
  // A delivery that no longer waits cannot be booked; cancelling is left.
  const closed = html(shipmentDefinition.pageActions!(shipmentContext({ pickingOpen: false }, worker)))
  assert.doesNotMatch(closed, /value="book"/)
  assert.match(
    html(shipmentDefinition.body!(shipmentContext({ pickingOpen: false }, worker))),
    /shipment\.closedTitle/,
  )
  // Booked: hand over waits for the goods, and says so.
  const waiting = shipmentContext({ state: 'booked' }, worker)
  assert.match(html(shipmentDefinition.pageActions!(waiting)), /value="handOver"[\s\S]*disabled/)
  assert.match(html(shipmentDefinition.body!(waiting)), /shipment\.waitingTitle/)
  const ready = html(
    shipmentDefinition.pageActions!(shipmentContext({ state: 'booked', ready: true }, worker)),
  )
  assert.match(ready, /value="handOver"/)
  assert.doesNotMatch(ready, /value="save"|value="book"/)
  // Under way: delivered or failed; failed: deliver again or bring back.
  const shipping = html(shipmentDefinition.pageActions!(shipmentContext({ state: 'shipping' }, worker)))
  assert.match(shipping, /value="deliver"/)
  assert.match(shipping, /shipment\.fail/)
  assert.doesNotMatch(shipping, /shipment\.cancel/)
  const failed = html(shipmentDefinition.pageActions!(shipmentContext({ state: 'failed' }, worker)))
  assert.match(failed, /value="retry"[\s\S]*|value="return"/)
  assert.match(failed, /value="return"/)
  assert.match(
    html(shipmentDefinition.body!(shipmentContext({ state: 'failed', failReason: 'Refused' }, worker))),
    /shipment\.failedMessage.*Refused/,
  )
  // A reader is offered no step.
  const reader = html(shipmentDefinition.pageActions!(shipmentContext({ state: 'booked', ready: true }, {})))
  assert.doesNotMatch(reader, /value="handOver"|shipment\.cancel/)
  assert.doesNotMatch(html(shipmentDefinition.body!(shipmentContext({}, {}))), /shipment-carrierId/)
  // The rail leads to the delivery; the order is named, plain, for who may not open it.
  const rail = html(shipmentDefinition.pageAside!(draft))
  assert.match(rail, /href="\/admin\/stock\/transfers\/order:delivery"/)
  assert.match(rail, /S0001/)
  assert.doesNotMatch(rail, /href="[^"]*S0001/)
  assert.deepEqual(
    Object.entries(shipmentDefinition.commands!).map(([name, command]) => [name, command.fn]),
    [
      ['save', 'stock.saveShipment'],
      ['book', 'stock.bookShipment'],
      ['handOver', 'stock.handOverShipment'],
      ['deliver', 'stock.deliverShipment'],
      ['retry', 'stock.retryShipment'],
      ['return', 'stock.returnShipment'],
      ['fail', 'stock.failShipment'],
      ['cancel', 'stock.cancelShipment'],
    ],
  )
})

const statementContext = (record: Row, permissions: Partial<Record<string, boolean>>, extra: Row = {}) =>
  ({
    kind: 'stock.deliveryStatement',
    id: String(record.id ?? 'new'),
    creating: !record.id,
    presentation: 'page',
    data: {
      record: { state: 'draft', carrierId: 'ghn', date: '2030-01-31', pending: 0, ...record },
      lang: 'en',
      draftId: 'draft-id',
      permissions: { save: false, post: false, settle: false, cancel: false, ...permissions },
      carrierName: 'Giao Hàng Nhanh',
      texts: {
        cod: '300,000 ₫',
        fees: '29,500 ₫',
        net: '270,500 ₫',
        signedNet: '270,500 ₫',
        date: '1/31/2030',
      },
      paying: false,
      lines: [
        {
          id: 'l1',
          name: 'WH/VD/0001',
          href: '/admin/stock/shipments/parcel',
          cod: '300,000 ₫',
          fee: '29,500 ₫',
        },
      ],
      links: { feeEntry: { name: 'KHO/2030/00003', href: null }, paymentEntry: null },
      today: '2030-01-31',
      carriers: [{ id: 'ghn', name: 'Giao Hàng Nhanh' }],
      journals: [{ id: 'bank', name: 'Ngân hàng · NH' }],
      ...extra,
    },
    draft: (_key: string, fallback: string) => fallback,
    fieldError: () => undefined,
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    busy: false,
    recordChanged: false,
  }) as never

test('K47 a statement is drafted, posted in one step with its save, settled through a journal, or cancelled', () => {
  const clerk = { save: true, post: true, settle: true, cancel: true }
  const draft = statementContext({ id: 'ds', name: 'GHN/DS/0001', pending: 2 }, clerk)
  const actions = html(deliveryStatementDefinition.pageActions!(draft))
  assert.match(actions, /value="save" form="stock-delivery-statement-form"/)
  assert.match(actions, /value="post" form="stock-delivery-statement-form"/)
  assert.match(actions, /statement\.cancel/)
  assert.deepEqual(
    [
      deliveryStatementDefinition.commands!.post!.fn,
      deliveryStatementDefinition.commands!.post!.also?.map((step) => step.fn),
    ],
    ['stock.saveDeliveryStatement', ['stock.postDeliveryStatement']],
  )
  const body = html(deliveryStatementDefinition.body!(draft))
  // A saved statement keeps its carrier.
  assert.match(body, /delivery-statement-carrierId[\s\S]*&quot;disabled&quot;:true|"disabled":true/)
  assert.match(body, /statement\.pendingTitle.*(&quot;n&quot;:&quot;2&quot;|"n":"2")/)
  assert.match(body, /href="\/admin\/stock\/shipments\/parcel"/)
  assert.match(body, /270,500 ₫/)
  // Posted: settled through a bank or cash journal, from its day to today.
  const posted = statementContext({ id: 'ds', name: 'GHN/DS/0001', state: 'posted' }, clerk)
  assert.match(html(deliveryStatementDefinition.pageActions!(posted)), /statement\.settle/)
  assert.doesNotMatch(
    html(deliveryStatementDefinition.pageActions!(posted)),
    /value="save"|statement\.cancel/,
  )
  const settle = html(deliveryStatementDefinition.dialogs!.settle!.view(posted))
  assert.match(settle, /delivery-statement-paid-date[\s\S]*2030-01-31/)
  assert.match(settle, /Ngân hàng · NH/)
  assert.match(settle, /statement\.settleReceive.*270,500 ₫/)
  assert.match(
    html(
      deliveryStatementDefinition.dialogs!.settle!.view(
        statementContext({ id: 'ds', state: 'posted' }, clerk, { paying: true }),
      ),
    ),
    /statement\.settlePay/,
  )
  // A stock manager or an auditor reads it and is offered nothing.
  const reader = statementContext({ id: 'ds', state: 'draft' }, {})
  assert.doesNotMatch(
    html(deliveryStatementDefinition.pageActions!(reader)),
    /value="save"|statement\.(post|cancel|settle)/,
  )
  assert.doesNotMatch(html(deliveryStatementDefinition.body!(reader)), /delivery-statement-carrierId/)
  // A new statement picks its carrier and has no rail.
  const fresh = statementContext({}, clerk)
  assert.match(html(deliveryStatementDefinition.body!(fresh)), /delivery-statement-carrierId/)
  assert.equal(deliveryStatementDefinition.pageAside!(fresh), undefined)
  assert.doesNotMatch(html(deliveryStatementDefinition.pageActions!(fresh)), /value="post"/)
})

test('K48 the shipping lists, pages, overview and a delivery’s link read on the server, each in its language and by permission', async (t) => {
  const r = await seed(t)
  await r.ship()
  await r.save('stock.deliverShipment', { id: 'parcel' })
  await r.save('stock.saveDeliveryStatement', { id: 'ds', carrierId: 'ghn' })
  const data = async (
    path: string,
    client: { request: (path: string, init?: RequestInit) => Promise<Response> } = r.app.client,
  ) => {
    const lang = new URL(path, 'http://ketsuite.test').searchParams.get('lang') ?? 'en'
    const response = await client.request(`${path.split('?')[0]}/data?lang=${lang}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ href: path }).toString(),
    })
    return response.status === 200 ? (await response.json()).value : response.status
  }
  const shipments = await data('/admin/stock/shipments?lang=en')
  assert.deepEqual(
    shipments.rows.map((row: Row) => [
      row.name,
      row.tracking,
      row.partner,
      row.carrier,
      row.statusText,
      row.href,
    ]),
    [
      [
        'WH/VD/0001',
        'GHN203000001',
        'Buyer',
        'Giao Hàng Nhanh',
        'Delivered',
        '/admin/stock/shipments/parcel?lang=en',
      ],
    ],
  )
  assert.match(shipments.rows[0].codText, /300,000/)
  assert.match(shipments.rows[0].feeText, /29,500/)
  assert.equal((await data('/admin/stock/shipments?lang=en&q=nothing')).rows.length, 0)
  assert.deepEqual((await data('/admin/stock/delivery/dispatch?lang=en')).rows, [])
  const statements = await data('/admin/stock/delivery-statements?lang=en')
  assert.deepEqual(
    statements.rows.map((row: Row) => [row.name, row.carrier, row.count, row.statusText, row.href]),
    [['GHN/DS/0001', 'Giao Hàng Nhanh', '1', 'Draft', '/admin/stock/delivery-statements/ds?lang=en']],
  )
  assert.match(statements.rows[0].netText, /270,500/)
  const carriers = await data('/admin/stock/carriers?lang=en')
  assert.deepEqual(
    carriers.rows.map((row: Row) => [row.code, row.name, row.isDefaultText, row.statusText, row.href]),
    [['GHN', 'Giao Hàng Nhanh', 'Yes', 'In use', '/admin/stock/carriers?lang=en&record=stock.carrier%3Aghn']],
  )
  assert.equal(carriers.rows[0].codFeeRateText, '1.5%')
  assert.equal((await data('/admin/stock/carriers?lang=vi')).rows[0].codFeeRateText, '1,5%')

  for (const [path, island, help] of [
    ['/admin/stock/shipments?lang=en', 'stock.delivery-results', 'stock-delivery-shipments-help'],
    ['/admin/stock/delivery/dispatch?lang=en', 'stock.delivery-results', 'stock-delivery-dispatch-help'],
    ['/admin/stock/delivery-statements?lang=en', 'stock.delivery-results', 'stock-delivery-statements-help'],
    ['/admin/stock/carriers?lang=en', 'stock.delivery-results', 'stock-delivery-carriers-help'],
    ['/admin/stock/shipments/parcel?lang=en', 'stock.shipment-page', 'stock-delivery-shipment-help'],
    [
      '/admin/stock/delivery-statements/ds?lang=en',
      'stock.delivery-statement-page',
      'stock-delivery-statement-help',
    ],
    [
      '/admin/stock/delivery-statements/new?lang=en',
      'stock.delivery-statement-page',
      'stock-delivery-statement-help',
    ],
  ]) {
    const response = await r.app.client.request(path!)
    assert.equal(response.status, 200, path)
    const markup = await page(response)
    assert.match(markup, new RegExp(`data-island="${island!.replace('.', '\\.')}"`), path)
    assert.match(markup, new RegExp(`id="${help}"`), path)
  }
  // A carrier's row opens its record modal, so the page hosts that modal.
  assert.match(
    await page(await r.app.client.request('/admin/stock/carriers?lang=en')),
    /data-island="stock\.carrier-modal"/,
  )
  // The queue ticks deliveries into draft shipments; the list ticks shipments to hand over.
  assert.match(
    await page(await r.app.client.request('/admin/stock/delivery/dispatch?lang=en')),
    /stock\.createShipments/,
  )
  assert.match(
    await page(await r.app.client.request('/admin/stock/shipments?lang=en')),
    /stock\.handOverShipments/,
  )
  assert.match(
    await page(await r.app.client.request('/admin/stock/delivery-statements?lang=en')),
    /delivery-statements\/new/,
  )
  assert.equal((await r.app.client.request('/admin/stock/shipments/missing?lang=en')).status, 404)

  const overview = await page(await r.app.client.request('/admin/stock/delivery?lang=en'))
  assert.match(overview, /Delivery overview/)
  assert.match(overview, /Giao Hàng Nhanh · GHN/)
  assert.match(overview, /COD held by carrier/)
  assert.match(overview, /id="stock-delivery-overview-help"/)
  // K51: a tile opens the parcels it counts; the one parcel is delivered, so none of them lists it.
  const tiles = [...overview.matchAll(/href="(\/admin\/stock\/shipments\?filter=[^"]*)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&'),
  )
  assert.deepEqual(
    tiles.map((href) => {
      const rule = JSON.parse(
        Buffer.from(
          new URL(href, 'http://ketsuite.test').searchParams.get('filter')!,
          'base64url',
        ).toString(),
      )
      return [rule.field, [rule.value].flat().join('+')]
    }),
    [
      ['status', 'booked'],
      ['status', 'shipping'],
      ['status', 'failed'],
      ['status', 'shipping+failed'],
    ],
  )
  for (const href of tiles) {
    assert.match(href, /lang=en/)
    assert.equal((await data(href)).rows.length, 0, href)
  }

  const context = async (
    path: string,
    client: { request: (path: string) => Promise<Response> } = r.app.client,
  ) => {
    const response = await client.request(path)
    return response.status === 200 ? (await response.json()).data : response.status
  }
  const shipment = await context('/admin/stock/shipment/parcel/context?lang=en')
  assert.deepEqual(Object.values(shipment.permissions), [true, true, true, true, true, true, true, true])
  assert.equal(shipment.links.picking.href, '/admin/stock/transfers/order%3Adelivery?lang=en')
  assert.equal(shipment.links.statement.href, '/admin/stock/delivery-statements/ds?lang=en')
  assert.equal(shipment.links.codEntry.name.startsWith('KHO/2030/'), true)
  assert.match(shipment.texts.cod, /300,000/)
  assert.equal(shipment.texts.deliveredDate, '1/31/2030')
  // The weight reads in the reader's language.
  assert.equal(shipment.texts.weight, '1.2')
  assert.equal((await context('/admin/stock/shipment/parcel/context?lang=vi')).texts.weight, '1,2')
  const statement = await context('/admin/stock/delivery-statement/ds/context?lang=en')
  assert.deepEqual(statement.permissions, { save: true, post: true, settle: true, cancel: true })
  assert.deepEqual(
    statement.lines.map((line: Row) => [line.name, line.outcome, line.href]),
    [['WH/VD/0001', 'Delivered', '/admin/stock/shipments/parcel?lang=en']],
  )
  const fresh = await context('/admin/stock/delivery-statement/new/context?lang=en')
  assert.equal(fresh.record.carrierId, 'ghn')
  // A delivery leads to its shipment.
  const delivery = await context('/admin/stock/transfer/order%3Adelivery/context?lang=en')
  assert.deepEqual([delivery.shipment.create, delivery.shipment.parcel.name], [false, 'WH/VD/0001'])
  assert.match(
    html(
      transferModalDefinition.pageAside!({
        ...(shipmentContext({}, {}) as object),
        id: 'order:delivery',
        data: delivery,
      } as never),
    ),
    /shipment\.ofPicking[\s\S]*WH\/VD\/0001/,
  )
  // Goods sent back to a supplier are no carrier's parcel: of two confirmed deliveries, only the one to a
  // customer offers one.
  for (const [id, to] of [
    ['to-supplier', 'wh:supplier'],
    ['to-customer', 'wh:customer'],
  ]) {
    await r.save('stock.createPicking', { id, name: id, pickingTypeId: 'wh:outgoing', locationDestId: to })
    await r.save('stock.addMove', {
      id: `${id}-move`,
      pickingId: id,
      name: 'Goods',
      productId: r.productId,
      productUomId: 'each',
      productUomQty: '1',
    })
    await r.save('stock.confirmPicking', { id })
  }
  assert.equal((await context('/admin/stock/transfer/to-supplier/context?lang=en')).shipment, null)
  assert.equal((await context('/admin/stock/transfer/to-customer/context?lang=en')).shipment.create, true)
  // A carrier opens in its record, archived ones too.
  const carrier = await context('/admin/stock/record/carrier/ghn/context?lang=en')
  assert.equal(carrier.record.code, 'GHN')
  assert.equal(carrier.save, true)
  // The stock accounting page takes the shipping accounts.
  const accounting = await page(await r.app.client.request('/admin/stock/accounting?lang=en'))
  for (const label of ['Carrying cost', 'Carrier payable', 'Cash held by carriers', 'Customer receivable'])
    assert.match(accounting, new RegExp(label))

  // A storekeeper works shipments but meets the locked statements and has no way to start one.
  await r.app.fixture.call('user.syncRoleTemplates', {}, { actor: 'system:role-templates' })
  const keeper = await r.signIn('commerce.warehouse-operator')
  const locked = await keeper.request('/admin/stock/delivery-statements?lang=en')
  assert.equal(locked.status, 403)
  assert.match(await page(locked), /This role cannot view carrier statements/)
  assert.equal(await data('/admin/stock/delivery-statements?lang=en', keeper), 403)
  assert.equal(await context('/admin/stock/delivery-statement/ds/context?lang=en', keeper), 403)
  const kept = await context('/admin/stock/shipment/parcel/context?lang=en', keeper)
  assert.equal(kept.links.statement, null)
  assert.equal(kept.permissions.handOver, true)
  assert.doesNotMatch(
    await page(await keeper.request('/admin/stock/shipments?lang=en')),
    /Carrier statements/,
  )
  // An auditor reads statements, and is offered neither a new one nor a step.
  const auditor = await r.signIn('commerce.tenant-auditor')
  assert.doesNotMatch(
    await page(await auditor.request('/admin/stock/delivery-statements?lang=en')),
    /delivery-statements\/new/,
  )
  assert.deepEqual(
    (await context('/admin/stock/delivery-statement/ds/context?lang=en', auditor)).permissions,
    {
      save: false,
      post: false,
      settle: false,
      cancel: false,
    },
  )
  assert.doesNotMatch(
    await page(await auditor.request('/admin/stock/shipments?lang=en')),
    /stock\.handOverShipments/,
  )
})

test('K45–K47 every shipping command sends what its function takes', async (t) => {
  const r = await seed(t, { books: false })
  const manifest = r.app.deployment.manifest
  // What a reader fills in on the shipment, statement and carrier forms and their dialogs.
  const form = new FormData()
  for (const [field, value] of Object.entries({
    carrierId: 'ghn',
    weight: '1.2',
    cod: '300000',
    trackingCode: 'GHN123',
    note: 'Gọi trước khi giao',
    reason: 'Khách vắng nhà',
    date: '2030-01-31',
    paidDate: '2030-01-31',
    journalId: 'bank',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    baseFee: '20000',
    extraKgFee: '5000',
    codFeeRate: '1.5',
    isDefault: 'true',
  }))
    form.set(field, value)
  const fits = <T,>(definition: RecordModalDefinition<T>, c: unknown, names: string[]) => {
    for (const name of names) {
      const command = definition.commands![name]!
      const args = command.input(form, c as never, {})
      assert.doesNotThrow(
        () => validateInput(command.fn!, manifest, args),
        `${definition.kind}.${name}: ${JSON.stringify(args)}`,
      )
    }
  }
  fits(
    shipmentDefinition,
    shipmentContext({ state: 'draft', carrierId: 'ghn' }, {}),
    Object.keys(shipmentDefinition.commands!),
  )
  fits(
    deliveryStatementDefinition,
    statementContext({ state: 'posted' }, {}),
    Object.keys(deliveryStatementDefinition.commands!),
  )
  fits(transferModalDefinition, { id: 'order:delivery', data: {} }, ['createShipment'])
  const carrier = stockConfigurationDefinition('carrier')
  for (const creating of [false, true])
    fits(
      carrier,
      { id: 'ghn', creating, data: { draftId: 'carrier-1', record: { id: 'ghn' } } },
      creating ? ['save'] : ['save', 'archive', 'activate'],
    )
})
