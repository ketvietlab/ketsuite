import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { transferModalDefinition as transfer } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult)
const line: Row = {
  id: 'm1',
  name: 'Goods',
  productId: 'goods',
  productUomId: 'each',
  productUomQty: '1',
  state: 'draft',
}
const context = (record: Row = {}, permissions: Row = {}) =>
  ({
    kind: 'stock.transfer',
    id: 't1',
    creating: false,
    data: {
      record: { id: 't1', name: 'WH/XK/0001', state: 'draft', moves: [line], ...record },
      permissions: { confirmPicking: true, cancelPicking: true, ...permissions },
      choices: { products: [], units: [] },
      draftId: 'draft-id',
    },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
    recordChanged: false,
  }) as never
/** The page's Confirm button, as rendered. */
const confirmButton = (c: never) => {
  const actions = html(transfer.pageActions!(c))
  const button =
    /<button[^>]*>(?:(?!<\/button>)[\s\S])*stock_backend\.action\.confirm<(?:(?!<\/button>)[\s\S])*<\/button>/.exec(
      actions,
    )?.[0]
  assert.ok(button, actions)
  return button
}

test('K18 a draft with no lines cannot be confirmed from its page, and says so', () => {
  assert.doesNotMatch(confirmButton(context()), /disabled/)
  assert.doesNotMatch(html(transfer.body!(context())), /transfer\.emptyNotice/)
  const empty = context({ moves: [] })
  assert.match(confirmButton(empty), /disabled/)
  assert.match(html(transfer.body!(empty)), /transfer\.emptyNotice/)
  // Whoever may not confirm is not asked to add a line first.
  assert.doesNotMatch(
    html(transfer.body!(context({ moves: [] }, { confirmPicking: false }))),
    /transfer\.emptyNotice/,
  )
})

test('K18 cancelling asks for a reason, and a cancelled transfer shows it', () => {
  const actions = html(transfer.pageActions!(context({ state: 'assigned' })))
  assert.match(actions, /data-ket-dialog="cancel"|dialog="cancel"/)
  const dialog = html(transfer.dialogs!.cancel!.view(context({ state: 'assigned' })))
  assert.match(dialog, /<textarea[^>]*name="reason"[^>]*required/)
  assert.equal(transfer.commands!.cancel!.confirm, undefined)
  assert.doesNotMatch(html(transfer.body!(context({ state: 'cancel' }))), /transfer\.cancelledNotice/)
  const cancelled = html(transfer.body!(context({ state: 'cancel', cancelReason: 'Khách đổi ý' })))
  assert.match(cancelled, /transfer\.cancelledNotice/)
  assert.match(cancelled, /Khách đổi ý/)
})
