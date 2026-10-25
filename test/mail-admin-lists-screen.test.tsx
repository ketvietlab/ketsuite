import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { inboxScreen } from '../packages/ketsuite/src/modules/mail_backend/screens/index.ts'
import { inboundScreen } from '../packages/ketsuite/src/modules/mail_inbound_backend/screens/index.ts'
import { outboxScreen } from '../packages/ketsuite/src/modules/mail_transport_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('inbox keeps the collection islands and a localized Help drawer in ListPage', () => {
  const html = renderToString(
    inboxScreen(
      translate,
      {},
      {
        controls: 'INBOX_CONTROLS',
        results: 'INBOX_RESULTS',
        footer: 'INBOX_FOOTER',
        rows: [{ body: 'PRIVATE_PREFETCH_BODY' }],
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="help-drawer"/)
  assert.match(html, /data-kv-design-system/, 'shared overlay and responsive styles retain their scope')
  for (const part of ['INBOX_CONTROLS', 'INBOX_RESULTS', 'INBOX_FOOTER']) assert.ok(html.includes(part))
  assert.ok(!html.includes('PRIVATE_PREFETCH_BODY'), 'SSR does not carry a business-data snapshot')
  assert.ok(html.indexOf('INBOX_FOOTER') < html.indexOf('INBOX_RESULTS'), 'pager precedes results')
})

test('inbound email log uses ListPage and retains diagnostic state', () => {
  const html = renderToString(
    inboundScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'event/a',
            providerEventId: 'provider/a',
            subject: 'Re: Order',
            fromAddress: 'buyer@example.com',
            provider: 'smtp',
            kind: 'reply',
            state: 'failed',
            diagnostic: 'Target was not found',
          },
        ],
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /mail_inbound_backend\.state\.failed/)
  assert.match(html, /Target was not found/)
})

test('outbox keeps island regions and Help without serializing rendered mail', () => {
  const html = renderToString(
    outboxScreen(
      translate,
      {},
      {
        controls: 'OUTBOX_CONTROLS',
        results: 'OUTBOX_RESULTS',
        footer: 'OUTBOX_FOOTER',
        rows: [{ text: 'PRIVATE_RESET_TOKEN' }],
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="help-drawer"/)
  for (const part of ['OUTBOX_CONTROLS', 'OUTBOX_RESULTS', 'OUTBOX_FOOTER']) assert.ok(html.includes(part))
  assert.ok(!html.includes('PRIVATE_RESET_TOKEN'))
  assert.ok(html.indexOf('OUTBOX_FOOTER') < html.indexOf('OUTBOX_RESULTS'), 'pager precedes results')
})
