import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import {
  benefitSection,
  benefitDialogs,
  benefitCommands,
} from '../packages/ketsuite/src/modules/sale_backend/modal/benefit-dialogs.tsx'
import { discountAction } from '../packages/ketsuite/src/modules/sale_backend/modal/discount-dialog.tsx'
import type { SaleOrderModalData } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const context = () =>
  ({
    kind: 'sale.order',
    id: 'order',
    creating: false,
    busy: false,
    recordChanged: false,
    data: {
      lang: 'en',
      record: { state: 'draft', revision: 7, currency: 'VND', lines: [], pickings: [], invoices: [] },
      permissions: { applyDiscount: true, benefitCode: true, benefitApply: true },
      benefits: {
        pointsEarned: 2,
        pointsSpent: 10,
        cards: [],
        available: [
          {
            programId: 'program',
            programName: 'Member',
            programType: 'loyalty',
            rewards: [
              { rewardId: 'reward', description: 'Reward', discountAmount: '20', requiredPoints: 10 },
            ],
          },
        ],
        applied: [
          {
            id: 'application',
            programId: 'program',
            name: 'Program',
            description: 'Applied',
            discountAmount: '10',
          },
        ],
      },
    },
    tab: 'lines',
    href: (tab: string) => '/admin/sales/orders/order?tab=' + tab,
    t: (key: string) => key,
    draft: (_key: string, fallback = '') => fallback,
    fieldError: () => null,
    state: (_key: string, fallback = '') => fallback,
  }) as unknown as RecordModalContext<SaleOrderModalData>

// C21: everything that takes money off sits in the Giảm giá menu; the benefits block only reads.
const menu = (c: RecordModalContext<SaleOrderModalData>) =>
  [...renderToString(html`${discountAction(c)}`).matchAll(/href="[^"]*dialog=(\w+)"/g)].map((m) => m[1])
test('D31f the discount menu lists what the quotation can take, and the benefits block only reads', () => {
  const c = context()
  assert.deepEqual(menu(c), ['discount', 'benefitCode', 'benefitPoints'])
  c.data.benefits!.available.push({
    programId: 'promotion',
    programName: 'Ten off',
    programType: 'promotion',
    rewards: [{ rewardId: 'ten', description: 'Ten off', discountAmount: '10', requiredPoints: 1 }],
  })
  assert.deepEqual(menu(c), ['discount', 'benefitReward', 'benefitCode', 'benefitPoints'])
  const section = renderToString(html`${benefitSection(c)}`)
  assert.match(section, /Applied/)
  assert.doesNotMatch(section, /data-record-dialog|dialog=/)
  c.data.permissions = { benefitCode: true }
  assert.deepEqual(menu(c), ['benefitCode'])
  c.data.permissions = {}
  assert.equal(discountAction(c), null)
  c.data.permissions = { applyDiscount: true, benefitCode: true, benefitApply: true }
  c.data.record.state = 'sale'
  assert.equal(discountAction(c), null)
})

test('D31f promotions and points list only their own rewards', () => {
  const c = context()
  c.data.benefits!.available.push({
    programId: 'promotion',
    programName: 'Ten off',
    programType: 'promotion',
    rewards: [{ rewardId: 'ten', description: 'Ten off', discountAmount: '10', requiredPoints: 1 }],
  })
  const promotions = renderToString(html`${benefitDialogs.benefitReward!.view(c)}`)
  const points = renderToString(html`${benefitDialogs.benefitPoints!.view(c)}`)
  assert.match(promotions, /Ten off/)
  assert.doesNotMatch(promotions, /Member/)
  assert.match(points, /Member/)
  assert.doesNotMatch(points, /Ten off/)
})

test('D31f quotation drafts block code and reward forms; no row button removes a benefit', () => {
  const c = context()
  c.recordChanged = true
  for (const key of ['benefitCode', 'benefitReward', 'benefitPoints']) {
    const rendered = renderToString(html`${benefitDialogs[key]!.view(c)}`)
    assert.match(rendered, /benefit.saveFirst/)
    assert.doesNotMatch(rendered, /name="code"|name="reward"/)
    assert.match(rendered, /disabled/)
  }
  assert.equal(benefitDialogs.benefitRemove, undefined)
  assert.equal(benefitCommands.benefitRemove, undefined)
})

test('D31f reward input cannot replace the parent quotation ID or revision', () => {
  const c = context(),
    form = new FormData()
  form.set(
    'reward',
    JSON.stringify({ programId: 'program', rewardId: 'reward', orderId: 'other', expectedRevision: 99 }),
  )
  assert.deepEqual(benefitCommands.benefitReward!.input!(form, c, {}), {
    orderId: 'order',
    expectedRevision: 7,
    programId: 'program',
    rewardId: 'reward',
  })
})

test('D31f selected reward details remain readable outside the compact selector and follow the draft', () => {
  const c = context()
  c.data.benefits!.available.push({
    programId: 'second',
    programName: 'Second program',
    programType: 'loyalty',
    rewards: [
      { rewardId: 'second-reward', description: 'Second reward', discountAmount: '15', requiredPoints: 5 },
    ],
  })
  c.state = (_key, fallback = '') =>
    _key === 'reward' ? JSON.stringify({ programId: 'second', rewardId: 'second-reward' }) : fallback
  const result = renderToString(html`${benefitDialogs.benefitPoints!.view(c)}`)
  assert.match(result.replace(/<!--[\s\S]*?-->/g, ''), /<dd[^>]*>Second program[^<]*Second reward/)
  assert.match(result, /selectedReward/)
  assert.match(result, /data-record-state="reward"/)
})
