import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Context = Parameters<NonNullable<typeof transferModalDefinition.body>>[0]
const valuation = {
  currency: 'VND',
  drafts: [],
  lines: [{ moveLineId: 'line', value: '3000' }],
  total: '3000',
  accountMoveName: 'KHO/2030/00001',
  entryHref: null,
  revaluable: [{ moveId: 'move', label: '[GOODS] Goods' }],
  revaluations: [
    {
      id: 'adjust',
      moveId: 'move',
      product: '[GOODS] Goods',
      amount: '-300',
      account: 'cogs',
      reason: 'Vendor credit note',
      date: '2030-01-31T05:00:00.000Z',
      accountMoveId: 'stock-revaluation:adjust',
      accountMoveName: 'KHO/2030/00002',
      entryHref: '/admin/accounting/entries/stock-revaluation%3Aadjust',
    },
  ],
}
const context = (data: Record<string, unknown>, state = 'done'): Context =>
  ({
    kind: 'stock.transfer',
    id: 'receipt',
    creating: false,
    data: {
      record: {
        id: 'receipt',
        name: 'WH/IN/0001',
        state,
        moves: [
          {
            id: 'move',
            name: 'Goods',
            productUomQty: '2',
            valuedReceipt: true,
            lines: [{ id: 'line', moveId: 'move', quantity: '2', picked: true }],
          },
        ],
      },
      choices: { revaluable: [{ id: 'move', name: '[GOODS] Goods' }] },
      permissions: { revaluePicking: true },
      valuation,
      draftId: 'draft-adjust',
      ...data,
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  }) as unknown as Context

const actions = (data: Record<string, unknown>, state = 'done') =>
  renderToString(transferModalDefinition.pageActions!(context(data, state)) as TemplateResult)

test('K63 a completed receipt offers Adjust valuation only to who may and only while a line carries value', () => {
  assert.match(actions({}), /stock_backend\.action\.revalue/)
  for (const html of [
    actions({ permissions: {} }),
    actions({ valuation: { ...valuation, revaluable: [] } }),
    actions({ valuation: null }),
    actions({}, 'assigned'),
  ])
    assert.doesNotMatch(html, /stock_backend\.action\.revalue/)
})

test('K63 the dialog asks for the line, a signed amount, the counterpart and a reason, and posts one adjustment', () => {
  const dialog = transferModalDefinition.dialogs!.revalue!
  const html = renderToString(<>{dialog.view(context({}))}</>)
  assert.match(html, /stock_backend\.revaluation\.notice/)
  // The line is a relation picker; the others are plain fields.
  assert.match(html, /data-island="backend\.relation-select"[^>]*&quot;name&quot;:&quot;moveId&quot;/)
  for (const name of ['amount', 'account', 'reason']) assert.match(html, new RegExp(`name="${name}"`))
  for (const account of ['supplier', 'cogs', 'gain', 'loss'])
    assert.match(html, new RegExp(`stock_backend\\.revaluation\\.account\\.${account}`))
  assert.match(html, /stock_backend\.revaluation\.save/)
  const form = new FormData()
  form.set('moveId', 'move')
  form.set('amount', '-300')
  form.set('account', 'cogs')
  form.set('reason', 'Vendor credit note')
  assert.deepEqual(transferModalDefinition.commands!.revalue!.input(form, context({}), {} as never), {
    id: 'receipt',
    revaluationId: 'draft-adjust',
    moveId: 'move',
    amount: '-300',
    account: 'cogs',
    reason: 'Vendor credit note',
  })
})

test('K63 the completed receipt lists each adjustment with its account, reason and entry', () => {
  const html = renderToString(<>{transferModalDefinition.body!(context({}))}</>)
  assert.match(html, /stock_backend\.revaluation\.title/)
  assert.match(html, /stock_backend\.revaluation\.account\.cogs/)
  assert.match(html, /Vendor credit note/)
  assert.match(html, /-300|−300/)
  assert.match(html, /href="\/admin\/accounting\/entries\/stock-revaluation%3Aadjust"/)
  assert.match(html, /KHO\/2030\/00002/)
  const none = renderToString(
    <>{transferModalDefinition.body!(context({ valuation: { ...valuation, revaluations: [] } }))}</>,
  )
  assert.doesNotMatch(none, /stock_backend\.revaluation\.title/)
})
