import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import stockBackend from '../packages/ketsuite/src/modules/stock_backend/index.ts'
import { deliveryMessages } from '../packages/ketsuite/src/modules/stock_backend/delivery/messages.ts'
import { transferModalDefinition as transfer } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { scheduledCell, scheduledLabelKey } from '../packages/ketsuite/src/modules/stock_backend/scheduled.ts'
import { stockOverviewScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/overview.tsx'
import { transfersListScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/transfers-list.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const messages = (stockBackend as unknown as { messages: Record<'vi' | 'en', Record<string, string>> })
  .messages
const translator = (lang: 'vi' | 'en') => {
  const translate = ((key: string) => {
    const bare = key.replace(/^stock_backend\./, '')
    return messages[lang][bare] ?? key
  }) as Translator
  translate.locale = lang
  translate.has = (key) => key.replace(/^stock_backend\./, '') in messages[lang]
  translate.resolves = translate.has
  return translate
}
const modal = (record: Row, data: Row, dialog?: Row) =>
  ({
    kind: 'stock.transfer',
    id: String(record.id ?? 'new'),
    creating: !record.id,
    dialog,
    data: { record, lang: 'vi', draftId: 'draft-id', choices: {}, permissions: {}, ...data },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => translator('vi')(key),
    busy: false,
  }) as never
const picking = (kind: string | null) =>
  modal(
    { id: 'p1', name: 'HCM/XK/0001', state: 'confirmed', pickingTypeId: 'wh:x', moves: [], reserves: true },
    { kind, scheduled: { label: '10/11/26 08:00', day: '2026-11-10' } },
    { name: 'edit', params: {} },
  )

test('a transfer names its scheduled day after what it plans, in Vietnamese and English', () => {
  for (const [lang, expected] of [
    ['vi', ['Ngày dự kiến nhập', 'Ngày dự kiến xuất', 'Ngày dự kiến chuyển', 'Nhập', 'Xuất', 'Chuyển']],
    [
      'en',
      [
        'Scheduled receipt date',
        'Scheduled delivery date',
        'Scheduled transfer date',
        'Receipt',
        'Delivery',
        'Transfer',
      ],
    ],
  ] as const)
    assert.deepEqual(
      [
        ...['incoming', 'outgoing', 'internal'].map((kind) => messages[lang][scheduledLabelKey(kind)]),
        ...['incoming', 'outgoing', 'internal'].map(
          (kind) => messages[lang][`transfer.scheduledKind.${kind}`],
        ),
      ],
      expected,
    )
  // A transfer whose kind is not known yet keeps the plain label.
  assert.equal(scheduledLabelKey(null), 'transfer.list.col.scheduledDate')
  assert.equal(scheduledLabelKey('mrp_operation'), 'transfer.list.col.scheduledDate')
  // The parcel queue holds only deliveries, so its column says so.
  assert.equal(deliveryMessages.vi['delivery.scheduled'], 'Ngày dự kiến xuất')
  assert.equal(deliveryMessages.en['delivery.scheduled'], 'Scheduled delivery date')
})

test('a list of several kinds puts the kind before the day', () => {
  const vi = translator('vi')
  assert.equal(scheduledCell(vi, 'outgoing', '10/11/26 08:00'), 'Xuất · 10/11/26 08:00')
  assert.equal(scheduledCell(vi, 'incoming', '12/11/26 08:00'), 'Nhập · 12/11/26 08:00')
  assert.equal(scheduledCell(vi, 'internal', '13/11/26 08:00'), 'Chuyển · 13/11/26 08:00')
  assert.equal(scheduledCell(vi, '', '13/11/26 08:00'), '13/11/26 08:00')
  assert.equal(scheduledCell(vi, 'outgoing', ''), '—')

  const list = html(
    transfersListScreen(
      vi,
      {
        createHref: null,
        total: 2,
        rows: [
          {
            id: 'a',
            name: 'HCM/XK/0001',
            operationType: 'Xuất hàng',
            kind: 'outgoing',
            source: 'HCM/Tồn kho',
            destination: 'Khách hàng',
            scheduledDate: '10/11/26 08:00',
            state: 'ready',
            href: '/a',
          },
          {
            id: 'b',
            name: 'HCM/NK/0001',
            operationType: 'Nhận hàng',
            kind: 'incoming',
            source: 'Nhà cung cấp',
            destination: 'HCM/Tồn kho',
            scheduledDate: '12/11/26 09:00',
            state: 'ready',
            href: '/b',
          },
        ],
      } as never,
      {} as never,
    ),
  )
  assert.match(list, /Xuất · 10\/11\/26 08:00/)
  assert.match(list, /Nhập · 12\/11\/26 09:00/)

  const overview = html(
    stockOverviewScreen(vi, {} as never, {
      rows: [
        {
          id: 'c',
          name: 'HCM/CK/0001',
          kind: 'internal',
          operationType: 'Chuyển nội bộ',
          scheduledDate: '13/11/26 10:00',
          state: 'confirmed',
          status: 'waiting',
        },
        {
          id: 'd',
          name: 'HCM/XK/0002',
          kind: 'outgoing',
          operationType: 'Xuất hàng',
          scheduledDate: '01/11/26 10:00',
          late: true,
          state: 'assigned',
          status: 'ready',
        },
      ],
      tiles: [],
      warehouses: [],
      warehouseChoices: [],
      showValue: false,
      at: (path) => path,
      rowHref: () => '#',
      createHref: null,
      cycles: [],
    }),
  )
  assert.match(overview, /Chuyển · 13\/11\/26 10:00/)
  // A late one keeps its warning after the day.
  assert.match(overview, new RegExp(`Xuất · 01/11/26 10:00 · ${messages.vi['overview.late']}`))
})

test('the page and edit form of one transfer name the day after its kind', () => {
  for (const [kind, label] of [
    ['incoming', 'Ngày dự kiến nhập'],
    ['outgoing', 'Ngày dự kiến xuất'],
    ['internal', 'Ngày dự kiến chuyển'],
  ] as const) {
    const edit = html(transfer.dialogs!.edit!.view(picking(kind)))
    assert.match(edit, new RegExp(`${label}`), kind)
    assert.match(html(transfer.body!(picking(kind))), new RegExp(label), kind)
  }
  // Before its kind is chosen, a transfer keeps the plain "Ngày dự kiến".
  const plain = html(transfer.dialogs!.edit!.view(picking(null)))
  assert.match(plain, /Ngày dự kiến/)
  assert.doesNotMatch(plain, /Ngày dự kiến (nhập|xuất|chuyển)/)
})
