import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx } from '@ketvietlab/ketjs'
import { functionsNamedBy, mayFor } from '../packages/ketsuite/src/ui/fill-needs.ts'
import {
  recordIslandsFor,
  recordTabsFor,
} from '../packages/ketsuite/src/modules/product/product-record-tabs.ts'

const chatter = '{% if may.product_mail_backend.timeline %}{% island "mail.chatter" %}{% endif %}'
const activities =
  '{% if may.activity.listTypes %}{% if may.product_activity_backend.list %}{% island "activity.record" %}{% endif %}{% endif %}'
const fills = [
  { joint: 'product_backend:template.collaboration', by: 'product_mail_backend', template: chatter },
  { joint: 'product_backend:template.collaboration', by: 'product_activity_backend', template: activities },
  { joint: 'product_backend:template.collaboration', by: 'unguarded', template: '{% island "x.panel" %}' },
  {
    joint: 'backend:sidebar.foot',
    by: 'mail_backend',
    template: '{% if may.mail.countUnread %}…{% endif %}',
  },
]

test('fill needs: a fill names the functions its condition asks about, each once', () => {
  assert.deepEqual(functionsNamedBy(activities), ['activity.listTypes', 'product_activity_backend.list'])
  assert.deepEqual(functionsNamedBy(`${chatter}${chatter}`), ['product_mail_backend.timeline'])
  assert.deepEqual(functionsNamedBy('{% island "x.panel" %}'), [])
})

test('fill needs: the may prop answers exactly what the joint’s fills name, for this viewer', async () => {
  const asked: string[] = []
  const may = await mayFor(fills, 'product_backend:template.collaboration', (name) => {
    asked.push(name)
    return name !== 'product_mail_backend.timeline'
  })
  assert.deepEqual(asked.sort(), [
    'activity.listTypes',
    'product_activity_backend.list',
    'product_mail_backend.timeline',
  ])
  assert.deepEqual(may, {
    product_mail_backend: { timeline: false },
    activity: { listTypes: true },
    product_activity_backend: { list: true },
  })
  // Another joint's fills are not asked about.
  assert.deepEqual(await mayFor(fills, 'backend:sidebar.foot', async () => false), {
    mail: { countUnread: false },
  })
})

test('fill needs: a client page leaves out an island whose named function the viewer may not call', () => {
  const ctx = { manifest: { fills } } as unknown as Pick<Ctx, 'manifest'>
  const joint = 'product_backend:template.collaboration'
  assert.deepEqual(
    recordIslandsFor(ctx, joint, () => true).map((entry) => entry.island),
    ['mail.chatter', 'activity.record', 'x.panel'],
  )
  // A viewer who may read the activities but not the timeline: no chatter, the rest stays.
  assert.deepEqual(
    recordIslandsFor(ctx, joint, (fn) => fn !== 'product_mail_backend.timeline').map((entry) => entry.island),
    ['activity.record', 'x.panel'],
  )
  // Both of the activity panel's reads are needed, not either.
  assert.deepEqual(
    recordIslandsFor(ctx, joint, (fn) => fn !== 'activity.listTypes').map((entry) => entry.island),
    ['mail.chatter', 'x.panel'],
  )
})

test('fill needs: a product tab whose fill names a function the viewer may not call is left out', () => {
  const ctx = {
    manifest: {
      messages: { vi: { 'count_tab.productTemplateTab': 'Quy đổi đếm cái' } },
      fills: [
        {
          joint: 'product_backend:template.recordTabs',
          by: 'count_tab',
          template: '{% if may.manufacturing.countContext %}{% island "count.panel" %}{% endif %}',
        },
        {
          joint: 'product_backend:template.recordTabs',
          by: 'open_tab',
          template: '{% island "open.panel" %}',
        },
      ],
    },
  } as unknown as Pick<Ctx, 'manifest'>
  assert.deepEqual(
    recordTabsFor(ctx, 'vi').map((tab) => [tab.island, tab.label]),
    [
      ['count.panel', 'Quy đổi đếm cái'],
      ['open.panel', 'open_tab'],
    ],
  )
  assert.deepEqual(
    recordTabsFor(ctx, 'vi', (fn) => fn !== 'manufacturing.countContext').map((tab) => tab.island),
    ['open.panel'],
  )
})
