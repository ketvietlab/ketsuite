import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const boot = {
  actor: { id: 'u1', name: 'Admin', capabilities: ['website.submission.manage'] },
  site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'vi', locales: ['vi'] },
  sites: [],
  offer: null,
  home: '/',
} as unknown as Boot

const render = async (path: string, answers: Record<string, unknown>) => {
  const studio = createWebsiteStudio(
    { path, query: {}, bootstrap: boot },
    { call: async (name: string) => (answers[name] ?? { rows: [], total: 0 }) as never },
  )
  await studio.serverFrame()
  return ['list', 'record', 'workspace']
    .map((k) => renderToString(studio.region({ id: `${k}-0.body`, initial: '' }) as never))
    .join('')
    .replace(/<!--k[^>]*-->/g, '')
}

const detail = (delivery: unknown) => ({
  'website_studio.submissionDetail': {
    form: { id: 'f1', title: 'Đặt bàn' },
    labels: { name: 'Họ tên' },
    submission: { id: 'sub-1', receipt: 'sub-1', fields: { name: 'An' }, delivery, audit: [] },
  },
})

test('submission queue: each row says where its email notice stands, in its own tone', async () => {
  const row = (id: string, deliveryState: string) => ({
    id,
    formId: 'f1',
    status: 'new',
    summary: id,
    excerpt: id,
    deliveryState,
    retentionUntil: null,
    createdAt: '2026-10-27T00:00:00.000Z',
  })
  const html = await render('forms/f1/submissions', {
    'website_form.getForm': { id: 'f1', siteId: 's1', title: 'Đặt bàn', active: true, retentionDays: null },
    'website_form.listSubmissions': {
      rows: [row('a', 'sent'), row('b', 'failed'), row('c', 'notQueued'), row('d', 'notConfigured')],
      total: 4,
    },
  })
  for (const [label, tone] of [
    ['Đã gửi email', 'positive'],
    ['Gửi không thành công', 'danger'],
    ['Chưa gửi email', 'warning'],
    ['Chưa cấu hình nơi nhận', 'neutral'],
  ])
    assert.match(html, new RegExp(`data-tone="${tone}"[^>]*>(?:<[^>]+>)*${label}`), label)
})

test('submission detail: a failed notice shows the outbox reason, a sent one when it went', async () => {
  const failed = await render(
    'submissions/sub-1',
    detail({ state: 'failed', attempts: 5, error: '550 mailbox unavailable', queuedAt: null, sentAt: null }),
  )
  assert.match(failed, /Thông báo email/)
  assert.match(failed, /Không gửi được email thông báo/)
  assert.match(failed, /550 mailbox unavailable/)

  const sent = await render(
    'submissions/sub-1',
    detail({ state: 'sent', attempts: 1, error: null, queuedAt: null, sentAt: '2026-10-27T03:04:05.000Z' }),
  )
  assert.match(sent, /Đã gửi email/)
  assert.doesNotMatch(sent, /Không gửi được email/)

  // A form with nobody to tell has no notice block at all.
  assert.doesNotMatch(await render('submissions/sub-1', detail(null)), /Thông báo email/)
})
