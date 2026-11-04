import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { countSessionModalDefinition as count } from '../packages/ketsuite/src/modules/stock_backend/modal/count-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { stockOverviewScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/overview.tsx'
import { warehousesListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/warehouses-list.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}
const modal = (kind: string, record: Row, data: Row, drafts: Record<string, string> = {}, dialog?: Row) =>
  ({
    kind,
    id: String(record.id ?? 'new'),
    creating: !record.id,
    dialog,
    data: { record, lang: 'en', draftId: 'draft-id', ...data },
    draft: (key: string, fallback: string) => drafts[key] ?? fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  }) as never
const choices = {
  warehouses: [{ id: 'wh', name: 'Main' }],
  products: [
    { id: 'goods', name: 'Goods · G1', tracking: 'none' },
    { id: 'serum', name: 'Serum · S1', tracking: 'lot' },
  ],
  lots: [],
}
const session = (record: Row, drafts: Record<string, string> = {}, dialog?: Row) =>
  modal(
    'stock.countSession',
    { state: 'counting', blind: true, lines: [], lineCount: 0, countedLines: 0, ...record },
    {
      permissions: { startCountSession: true, addCountLine: true },
      links: { shortage: null, excess: null },
      value: null,
      choices,
    },
    drafts,
    dialog,
  )

test('K62 the start form chooses the products of a partial count and sends them as a list', () => {
  const start = html(count.body!(session({ state: 'new' }, { productIds: 'serum' })))
  assert.match(start, /count-record-productIds/)
  assert.match(start, /&quot;multiple&quot;:true|"multiple":true/)
  assert.match(start, /&quot;values&quot;:\[&quot;serum&quot;\]|"values":\["serum"\]/)
  assert.match(start, /stock_backend\.count\.productsHelp/)
  assert.deepEqual(
    count.commands!.start!.input(
      form({ warehouseId: 'wh', productIds: 'goods,serum' }),
      session({}),
      {} as never,
    ).productIds,
    ['goods', 'serum'],
  )
  assert.deepEqual(
    count.commands!.start!.input(form({ warehouseId: 'wh' }), session({}), {} as never).productIds,
    [],
  )
})

test('K62 a partial count names its products and finds goods only among them', () => {
  const partial = session({ id: 'c1', name: 'WH/KK/0002', productIds: ['serum'] })
  const body = html(count.body!(partial))
  assert.match(body, /stock_backend\.count\.scope<[\s\S]*Serum · S1/)
  assert.doesNotMatch(body, /stock_backend\.count\.scopeAll/)
  const add = html(
    count.dialogs!.add!.view(session({ id: 'c1', productIds: ['serum'] }, {}, { name: 'add', params: {} })),
  )
  assert.match(add, /Serum · S1/)
  assert.doesNotMatch(add, /Goods · G1/)
  const whole = session({ id: 'c2', name: 'WH/KK/0003', productIds: null })
  assert.match(html(count.body!(whole)), /stock_backend\.count\.scopeAll/)
  assert.match(
    html(count.dialogs!.add!.view(whole)),
    /Goods · G1[\s\S]*Serum · S1|Serum · S1[\s\S]*Goods · G1/,
  )
})

test('K10 the location modal mounts its guide and a button that opens it', () => {
  const location = stockConfigurationDefinition('location')
  const c = modal(
    'stock.location',
    { id: 'wh:adjustment', name: 'Điều chỉnh tồn kho', usage: 'inventory', warehouseId: 'wh' },
    { save: true, choices: { locations: [], warehouses: [] } },
  )
  assert.match(html(location.body!(c)), /id="stock-location-help"/)
  assert.match(html(location.actions!(c)), /name="screen-help"/)
})

test('K62 the warehouse form sets the count frequency, posts an emptied one as none and opens its Help', () => {
  const warehouse = stockConfigurationDefinition('warehouse')
  const c = modal(
    'stock.warehouse',
    {
      id: 'wh',
      name: 'Main',
      code: 'WH',
      receptionSteps: 'one_step',
      deliverySteps: 'ship_only',
      countFrequencyDays: 30,
    },
    { save: true, choices: {} },
  )
  const body = html(warehouse.body!(c))
  assert.match(body, /name="countFrequencyDays"[^>]*value="30"|value="30"[^>]*name="countFrequencyDays"/)
  assert.match(body, /stock_backend\.warehouse\.countFrequencyHelp/)
  assert.match(body, /id="stock-warehouse-help"/)
  assert.match(html(warehouse.actions!(c)), /name="screen-help"/)
  const fields = { name: 'Main', code: 'WH', receptionSteps: 'one_step', deliverySteps: 'ship_only' }
  const save = warehouse.commands!.save!
  assert.equal(
    save.input(form({ ...fields, countFrequencyDays: '14' }), c, {} as never).countFrequencyDays,
    14,
  )
  assert.equal(save.input(form({ ...fields, countFrequencyDays: '' }), c, {} as never).countFrequencyDays, 0)
  // Other numbers still leave an empty field out.
  const route = stockConfigurationDefinition('route')
  const routeContext = modal('stock.route', { id: 'r1', name: 'R' }, { save: true, choices: {}, rules: [] })
  assert.equal(
    'sequence' in route.commands!.save!.input(form({ name: 'R', sequence: '' }), routeContext, {} as never),
    false,
  )
})

const messages: Record<string, string> = {
  'stock_backend.overview.title': 'Tổng quan kho',
  'stock_backend.overview.countDue': 'Kho đến hạn kiểm kê',
  'stock_backend.overview.cycle.title': 'Kiểm kê theo chu kỳ',
  'stock_backend.overview.cycle.days': '{days} ngày',
  'stock_backend.overview.cycle.never': 'Chưa có',
  'stock_backend.overview.cycle.due': 'Đến hạn',
  'stock_backend.overview.cycle.notDue': 'Chưa đến hạn',
  'stock_backend.overview.cycle.counting': 'Đang kiểm kê · {name}',
  'stock_backend.overview.help': 'Hướng dẫn Tổng quan kho',
  'stock_backend.warehouse.help': 'Hướng dẫn Kho hàng',
}
const t = ((key: string, params?: Record<string, unknown>) => {
  let value = messages[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Translator
t.locale = 'vi'
t.has = (key) => key in messages
t.resolves = t.has
const applications = { items: [], label: 'Ứng dụng' }

test('K62 the overview reports warehouses due for a count, due first, and opens its Help', () => {
  const cycle = (row: Row) => ({
    countFrequencyDays: 30,
    lastCountDate: null,
    nextCountDate: '2030-02-01',
    countDue: false,
    countingId: null,
    countingName: null,
    ...row,
  })
  const rendered = html(
    stockOverviewScreen(t, { applications } as never, {
      rows: [],
      tiles: [],
      warehouses: [],
      warehouseChoices: [],
      showValue: false,
      at: (path) => path,
      rowHref: () => '#',
      createHref: null,
      cycles: [
        cycle({
          warehouseId: 'later',
          name: 'Kho Bắc',
          nextCountDate: '2030-03-02',
          lastCountDate: '2030-01-31',
        }),
        cycle({ warehouseId: 'busy', name: 'Kho Nam', countingId: 'c9', countingName: 'NA/KK/0004' }),
        cycle({ warehouseId: 'due', name: 'Kho Đông', nextCountDate: '2030-02-15', countDue: true }),
        cycle({ warehouseId: 'off', name: 'Kho Tây', countFrequencyDays: 0, nextCountDate: null }),
      ],
      cycleHref: (row) => `/open/${String(row.warehouseId)}`,
    }),
  )
  // The Help drawer names the same things; the page is what precedes it.
  const help = rendered.indexOf('id="stock-overview-help"')
  assert.ok(help > 0)
  const page = rendered.slice(0, help)
  assert.match(page, /Kho đến hạn kiểm kê[\s\S]*?>1</)
  assert.match(page, /Kiểm kê theo chu kỳ/)
  const order = ['Kho Đông', 'Kho Nam', 'Kho Bắc'].map((name) => page.indexOf(name))
  assert.ok(
    order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!)),
    String(order),
  )
  assert.doesNotMatch(page, /Kho Tây/)
  assert.match(page, /Đến hạn/)
  assert.match(page, /Đang kiểm kê · NA\/KK\/0004/)
  assert.match(page, /30 ngày/)
  assert.match(page, /31\/1\/30/)
  assert.match(page, /Chưa có/)
  assert.match(page, /\/open\/busy/)
  assert.match(page, /data-ui="app-switcher-help"[^>]*aria-label="Hướng dẫn Tổng quan kho"/)

  // Without a warehouse on a cycle, the overview keeps to transfers.
  const plain = html(
    stockOverviewScreen(
      t,
      {},
      {
        rows: [],
        tiles: [],
        warehouses: [],
        warehouseChoices: [],
        showValue: false,
        at: (path) => path,
        rowHref: () => '#',
        createHref: null,
        cycles: [],
      },
    ),
  )
  assert.doesNotMatch(
    plain.slice(0, plain.indexOf('id="stock-overview-help"')),
    /Kiểm kê theo chu kỳ|Kho đến hạn kiểm kê/,
  )
})

test('K62 the warehouses list opens the warehouses Help', () => {
  const page = html(warehousesListScreen(t, { rows: [], createHref: null }, { applications } as never))
  assert.match(page, /id="stock-warehouses-help"/)
  assert.match(page, /data-ui="app-switcher-help"[^>]*aria-label="Hướng dẫn Kho hàng"/)
})
