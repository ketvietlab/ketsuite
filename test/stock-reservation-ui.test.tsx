import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { transferModalDefinition as transfer } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { transfersListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/transfers-list.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}
/** Keys stand for their text; parameters show as `key{name=value}`. */
const t = (key: string, params?: Row) =>
  params ? `${key}{${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`)}}` : key
const modal = (kind: string, record: Row, data: Row, dialog?: Row) =>
  ({
    kind,
    id: String(record.id ?? 'new'),
    creating: !record.id,
    dialog,
    data: { record, lang: 'en', draftId: 'draft-id', choices: {}, permissions: {}, ...data },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t,
    busy: false,
  }) as never
const delivery = (record: Row = {}, permissions: Row = {}, dialog?: Row) =>
  modal(
    'stock.transfer',
    {
      id: 'out',
      name: 'WH/OUT/0001',
      state: 'assigned',
      pickingTypeId: 'wh:outgoing',
      reserves: true,
      moves: [],
      reservation: { method: 'manual', reserveFrom: null },
      ...record,
    },
    { permissions },
    dialog,
  )

test('K60 the transfer says how its warehouse reserves, marks priority, and offers Unreserve while it holds goods', () => {
  const byDate = html(
    transfer.body!(
      delivery({ priority: true, reservation: { method: 'by_date', reserveFrom: '2030-02-08' } }),
    ),
  )
  assert.match(byDate, /stock_backend\.transfer\.priority[\s\S]*?stock_backend\.modal\.yes/)
  assert.match(
    byDate,
    /stock_backend\.transfer\.reservation[\s\S]*?stock_backend\.reservationMethod\.by_date · stock_backend\.transfer\.reserveFrom\{date=08\/02\/2030\}/,
  )
  // The page's guide sits beside the record in the page's content slot, not in its body.
  assert.doesNotMatch(byDate, /id="stock-transfer-help"/)
  const manual = html(transfer.body!(delivery()))
  assert.match(manual, /stock_backend\.reservationMethod\.manual/)
  assert.doesNotMatch(manual, /stock_backend\.transfer\.priority/)
  // Given back by a person, a transfer of a warehouse that reserves on its own waits for Reserve.
  const paused = (record: Row) => html(transfer.body!(delivery({ reservationPaused: true, ...record })))
  assert.match(
    paused({ reservation: { method: 'at_confirm', reserveFrom: null } }),
    /stock_backend\.reservationMethod\.at_confirm · stock_backend\.transfer\.reservationPaused/,
  )
  assert.match(
    paused({ reservation: { method: 'by_date', reserveFrom: '2030-02-08' } }),
    /reserveFrom\{date=08\/02\/2030\} · stock_backend\.transfer\.reservationPaused/,
  )
  // By hand it always waits, and a finished transfer waits for nothing.
  assert.doesNotMatch(paused({}), /reservationPaused/)
  assert.doesNotMatch(
    paused({ state: 'done', reservation: { method: 'at_confirm', reserveFrom: null } }),
    /reservationPaused/,
  )
  assert.doesNotMatch(
    html(transfer.body!(delivery({ reservation: { method: 'at_confirm', reserveFrom: null } }))),
    /reservationPaused/,
  )
  // A receipt has no method and no line for it.
  assert.doesNotMatch(
    html(transfer.body!(delivery({ reservation: { method: null, reserveFrom: null } }))),
    /stock_backend\.transfer\.reservation/,
  )

  const permitted = { unreservePicking: true, assignPicking: true }
  const holding = html(transfer.pageActions!(delivery({}, permitted)))
  assert.match(holding, /stock_backend\.action\.unreserve/)
  const waiting = html(transfer.pageActions!(delivery({ state: 'confirmed' }, permitted)))
  assert.doesNotMatch(waiting, /stock_backend\.action\.unreserve/)
  assert.match(waiting, /stock_backend\.action\.assign/)
  assert.doesNotMatch(
    html(transfer.pageActions!(delivery({}, { assignPicking: true }))),
    /stock_backend\.action\.unreserve/,
  )
  // A receipt holds no stock to give back.
  assert.doesNotMatch(
    html(transfer.pageActions!(delivery({ reserves: false }, permitted))),
    /stock_backend\.action\.unreserve/,
  )

  const c = delivery({ state: 'draft' })
  assert.deepEqual(transfer.commands!.confirm!.input(form({}), c, {} as never), { id: 'out', reserve: true })
  assert.deepEqual(transfer.commands!.unreserve!.input(form({}), c, {} as never), { id: 'out' })
  assert.equal(transfer.commands!.unreserve!.fn, 'stock.unreservePicking')
})

test('K60 the edit and create dialogs tick Priority with its help and send it either way', () => {
  const edit = html(
    transfer.dialogs!.edit!.view(delivery({ priority: true }, {}, { name: 'edit', params: {} })),
  )
  assert.match(edit, /name="priority"[^>]*checked|checked[^>]*name="priority"/)
  assert.match(edit, /stock_backend\.transfer\.priorityHelp/)
  const plain = html(
    transfer.dialogs!.edit!.view(delivery({ priority: false }, {}, { name: 'edit', params: {} })),
  )
  assert.doesNotMatch(plain, /name="priority"[^>]*checked|checked[^>]*name="priority"/)
  const c = delivery({ moveType: 'direct' })
  assert.equal(
    transfer.commands!.edit!.input(form({ name: 'X', priority: '1' }), c, {} as never).priority,
    true,
  )
  assert.equal(transfer.commands!.edit!.input(form({ name: 'X' }), c, {} as never).priority, false)
  assert.equal(
    transfer.commands!.create!.input(form({ name: 'X', priority: '1' }), c, {} as never).priority,
    true,
  )
})

test('K60 the warehouse form picks how transfers reserve, sends emptied days as 0 or none, and reads Manually when never chosen', () => {
  const warehouse = stockConfigurationDefinition('warehouse')
  const record = {
    id: 'wh',
    name: 'Main',
    code: 'WH',
    receptionSteps: 'one_step',
    deliverySteps: 'ship_only',
  }
  const c = modal(
    'stock.warehouse',
    { ...record, reservationMethod: 'by_date', reservationDaysBefore: 2 },
    { save: true },
  )
  const body = html(warehouse.body!(c))
  for (const field of ['reservationMethod', 'reservationDaysBefore', 'reservationDaysBeforePriority'])
    assert.match(body, new RegExp(`stock_backend\\.warehouse\\.field\\.${field}`))
  assert.match(body, /stock_backend\.warehouse\.reservationMethodHelp/)
  assert.match(
    body,
    /stock_backend\.reservationMethod\.at_confirm[\s\S]*stock_backend\.reservationMethod\.manual[\s\S]*stock_backend\.reservationMethod\.by_date/,
  )
  assert.match(body, /name="reservationDaysBefore"[^>]*value="2"|value="2"[^>]*name="reservationDaysBefore"/)
  const save = warehouse.commands!.save!
  const fields = { ...record, reservationMethod: 'by_date' }
  const sent = save.input(
    form({ ...fields, reservationDaysBefore: '3', reservationDaysBeforePriority: '7' }),
    c,
    {} as never,
  )
  assert.deepEqual(
    [sent.reservationMethod, sent.reservationDaysBefore, sent.reservationDaysBeforePriority],
    ['by_date', 3, 7],
  )
  const emptied = save.input(
    form({ ...fields, reservationDaysBefore: '', reservationDaysBeforePriority: '' }),
    c,
    {} as never,
  )
  assert.deepEqual([emptied.reservationDaysBefore, emptied.reservationDaysBeforePriority], [0, null])

  // Read-only, a warehouse that never chose shows the default.
  const reader = modal('stock.warehouse', record, { save: false })
  assert.match(html(warehouse.body!(reader)), /stock_backend\.reservationMethod\.manual/)
})

const translate = ((key: string) => key) as Translator
translate.locale = 'vi'
translate.has = () => false
translate.resolves = translate.has

test('K60 the transfers list badges priority transfers and opens its Help', () => {
  const row = (id: string, priority: boolean) => ({
    id,
    name: id,
    operationType: 'Giao hàng',
    source: 'WH/Tồn kho',
    destination: 'Khách hàng',
    scheduledDate: '08/02/2030',
    state: 'confirmed',
    priority,
    href: `/admin/stock/transfers/${id}?lang=vi`,
  })
  const page = html(
    transfersListScreen(
      translate,
      { createHref: null, rows: [row('urgent', true), row('plain', false)], total: 2 },
      {
        applications: {
          id: 'apps',
          label: 'Apps',
          items: [],
          helpLabel: 'unused',
        },
      } as never,
    ),
  )
  const cells = [...page.matchAll(/<td[^>]*data-col="priority"[^>]*>([\s\S]*?)<\/td>/g)].map(
    (match) => match[1]!,
  )
  assert.equal(cells.length, 2)
  assert.match(cells[0]!, /stock_backend\.transfer\.priority/)
  assert.doesNotMatch(cells[1]!, /stock_backend\.transfer\.priority/)
  assert.match(page, /id="stock-transfers-help"/)
  assert.match(page, /stock_backend\.transfer\.help/)
})

test('C30 the edit dialog sends the planned day only when the reader changed it', () => {
  const c = modal(
    'stock.transfer',
    { id: 'out', name: 'WH/OUT/0001', state: 'draft', pickingTypeId: 'wh:outgoing', moves: [] },
    { scheduled: { label: '01/06/2031, 00:00', day: '2031-06-01' } },
  )
  // The form shows only the day: sending it back unchanged would move a 00:00 plan to UTC midnight.
  const kept = transfer.commands!.edit!.input(
    form({ name: 'X', scheduledDate: '2031-06-01' }),
    c,
    {} as never,
  )
  assert.equal(Object.hasOwn(kept, 'scheduledDate'), false)
  const moved = transfer.commands!.edit!.input(
    form({ name: 'X', scheduledDate: '2031-06-03' }),
    c,
    {} as never,
  )
  assert.equal(moved.scheduledDate, '2031-06-03')
})
