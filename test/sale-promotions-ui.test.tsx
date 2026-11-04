import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import type { Ctx } from '@ketvietlab/ketjs'
import { searchProgramReferences } from '../packages/ketsuite/src/modules/loyalty_sale/functions/program-readers.ts'
import {
  promotionDefinition,
  programInput,
  type Data,
} from '../packages/ketsuite/src/modules/sale_promotion_backend/record/view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const context = (state: Record<string, string> = {}) =>
  ({
    kind: 'sale.promotion',
    id: 'program',
    creating: false,
    busy: false,
    recordChanged: false,
    data: {
      record: {
        id: 'program',
        name: 'Program',
        revision: 4,
        programType: 'promotion',
        active: true,
        cards: 0,
      },
      references: {},
      save: true,
      lifecycle: true,
      generate: true,
      cardHref: '/cards',
      lang: 'en',
    },
    t: (key: string) => key,
    draft: (_key: string, fallback = '') => fallback,
    state: (key: string, fallback = '') => state[key] ?? fallback,
    fieldError: () => null,
  }) as unknown as RecordModalContext<Data>
const body = (c: RecordModalContext<Data>) => renderToString(html`${promotionDefinition.body!(c)}`)
test('D31d reference projection narrows a multi-company read scope and retains shared references', async () => {
  const ctx = {
    scope: { company: 'acme', companies: ['acme', 'other'] },
    db: {
      select: async () => [
        { id: 'own', name: 'Own', companyId: 'acme', active: true },
        { id: 'foreign', name: 'Foreign', companyId: 'other', active: true },
        { id: 'shared', name: 'Shared', companyId: null, active: true },
      ],
    },
  } as unknown as Ctx
  assert.deepEqual(
    (await searchProgramReferences(ctx, { kind: 'tag' })).map((row) => row.id),
    ['own', 'shared'],
  )
  assert.deepEqual(await searchProgramReferences(ctx, { kind: 'tag', ids: ['foreign'] }), [])
})
test('D31d native form exposes the fields required by each of the six program kinds', () => {
  for (const type of ['promotion', 'promo_code', 'buy_x_get_y', 'coupons', 'next_order_coupons', 'loyalty']) {
    const markup = body(context({ programType: type }))
    assert.match(markup, /name="name"/)
    assert.doesNotMatch(markup, /Chọn ngày/)
    assert.equal(markup.includes('name="code"'), type === 'promo_code')
    assert.equal(
      markup.includes('name="maxUsage"'),
      ['promotion', 'promo_code', 'buy_x_get_y'].includes(type),
    )
    assert.equal(markup.includes('name="pointAmount"'), type === 'loyalty')
    assert.equal(markup.includes('name="rewardProductQuantity"'), type === 'buy_x_get_y')
  }
  assert.doesNotMatch(body(context({ programType: 'loyalty', pointMode: 'order' })), /name="pointStep"/)
  assert.doesNotMatch(body(context({ discountMode: 'per_order' })), /name="discountMaximum"/)
})
test('D31d native form retains drafts and field errors, locks issued kinds and omits write actions for readers', () => {
  const c = context()
  c.data.record.cards = 1
  c.draft = (key, fallback = '') => (key === 'name' ? 'Preserved draft' : fallback)
  c.fieldError = (key) => (key === 'name' ? 'Duplicate name' : null)
  const markup = body(c)
  assert.match(markup, /value="Preserved draft"/)
  assert.match(markup, /Duplicate name/)
  assert.match(markup, /<select[^>]*name="programType"[^>]*disabled/)
  c.data.save = c.data.lifecycle = c.data.generate = false
  const actions = renderToString(html`${promotionDefinition.pageActions!(c)}`)
  assert.doesNotMatch(actions, /sale_promotion_backend\.(save|generate|archive)/)
})
test('D31d coupon dialog blocks pending parent edits and save carries the current revision', () => {
  const c = context()
  c.recordChanged = true
  const dialog = promotionDefinition.dialogs!.coupons!
  const blocked = renderToString(html`${dialog.view(c)}`)
  assert.match(blocked, /saveFirst/)
  assert.doesNotMatch(blocked, /name="count"/)
  c.recordChanged = false
  assert.match(renderToString(html`${dialog.view(c)}`), /name="count"/)
  const form = new FormData()
  form.set('name', 'Saved draft')
  form.set('productIds', 'sku-a,sku-b')
  const input = programInput(form, c)
  assert.equal(input.expectedRevision, 4)
  assert.deepEqual(input.values.productIds, ['sku-a', 'sku-b'])
  c.creating = true
  assert.equal(programInput(form, c).id, undefined)
})
