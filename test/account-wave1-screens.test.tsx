import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { LinkButton } from '../packages/ketsuite/src/ui/index.ts'
import { formatMoney } from '../packages/ketsuite/src/ui/money-format.ts'
import {
  openingBalanceDetailScreen,
  openingBalancesListScreen,
  periodCloseDetailScreen,
  periodClosesListScreen,
} from '../packages/ketsuite/src/modules/account_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has

test('account wave 1 screens keep rejected opening and close actions visible', () => {
  const opening = renderToString(
    openingBalanceDetailScreen(translate, {
      frame: {},
      batch: {
        id: 'opening-1',
        accountingDate: '2026-01-01',
        sourceChecksum: 'checksum',
        state: 'validated',
        controlDebit: '10',
        controlCredit: '10',
      },
      lines: [
        {
          id: 'line-1',
          sequence: 10,
          accountId: 'account-111',
          description: 'Cash',
          debit: '10',
          credit: '0',
        },
      ],
      accountLabel: (id) => (id === 'account-111' ? '111 · Cash' : String(id)),
      action: '/admin/accounting/opening-balances/opening-1',
      currency: 'USD',
      errors: ['The posting period is locked'],
    }),
  )
  assert.match(opening, /The posting period is locked/)
  // A source line names its account by code and name, not by the opaque id.
  assert.match(opening, /111 · Cash/)
  assert.doesNotMatch(opening, />account-111</)
  // The control totals read as money, like the line amounts below them.
  const money = formatMoney(translate, '10', 'USD')
  assert.notEqual(money, '10')
  assert.equal(opening.split(money).length - 1, 3, 'two control totals and one line amount')

  const closes = renderToString(
    periodClosesListScreen(translate, {
      frame: {},
      rows: [],
      action: '/admin/accounting/period-closes',
      fields: [],
      rowHref: (row) => `/admin/accounting/period-closes/${String(row.id)}`,
      errors: ['The close period overlaps an existing period'],
    }),
  )
  assert.match(closes, /data-ui="form-errors" role="alert"/)
  assert.match(closes, /The close period overlaps an existing period/)
  assert.match(closes, /data-ui="disclosure"[^>]*open/)
})

test('opening balances keep creation in the header while period close forms stay in the body', () => {
  const frame = {
    chrome: { search: { name: 'q', value: '', placeholder: 'Search' } },
    extras: {
      'topbar.end': (
        <LinkButton
          label="Export periods"
          href="/admin/accounting/period-closes/export?lang=vi"
          variant="secondary"
        />
      ),
    },
  }
  const opening = renderToString(
    openingBalancesListScreen(translate, {
      frame,
      rows: [
        {
          id: 'opening-1',
          accountingDate: '2026-01-01',
          state: 'draft',
          controlDebit: '10',
          sourceChecksum: 'source',
        },
      ],
      createHref: '/admin/accounting/opening-balances/new?lang=vi',
      rowHref: (row) => `/admin/accounting/opening-balances/${String(row.id)}?lang=vi`,
    }),
  )
  const closes = renderToString(
    periodClosesListScreen(translate, {
      frame,
      rows: [
        {
          id: 'period-1',
          periodKey: '2026-01',
          dateFrom: '2026-01-01',
          dateTo: '2026-01-31',
          state: 'open',
          blockerCount: 0,
        },
      ],
      action: '/admin/accounting/period-closes?lang=vi',
      fields: [],
      rowHref: (row) => `/admin/accounting/period-closes/${String(row.id)}?lang=vi`,
    }),
  )
  for (const html of [opening, closes]) {
    assert.match(html, /data-ui="ket-table"/)
    assert.ok(html.indexOf('data-ui="chrome-search"') < html.indexOf('data-ui="ket-table"'))
  }
  assert.ok(
    opening.indexOf('href="/admin/accounting/opening-balances/new?lang=vi"') <
      opening.indexOf('data-ui="chrome-search"'),
  )
  assert.equal(opening.match(/data-ui="list-page-actions"/g)?.length, 1)
  const headerStart = closes.indexOf('data-ui="list-page-header"')
  const header = closes.slice(headerStart, closes.indexOf('</header>', headerStart))
  assert.match(header, /data-ui="list-page-tools"[\s\S]*?Export periods/)
  assert.doesNotMatch(header, /close-create-form|data-ui="record-form"|data-ui="disclosure"/)
  assert.ok(closes.indexOf('data-ui="chrome-search"') < closes.indexOf('data-ui="list-page-body"'))
  assert.ok(closes.indexOf('data-ui="list-page-body"') < closes.indexOf('id="close-create-form"'))
  assert.ok(closes.indexOf('id="close-create-form"') < closes.indexOf('data-ui="ket-table"'))
  assert.match(closes, /action="\/admin\/accounting\/period-closes\?lang=vi"/)
})

test('a period close shows its locks by kind and who may still post, as a form only to the chief accountant', () => {
  const period = {
    id: 'close-1',
    periodKey: '2026-12',
    dateFrom: '2026-12-01',
    dateTo: '2026-12-31',
    state: 'open',
    revision: 4,
    lockedKinds: ['bills'],
    softPosters: ['user-chief', 'user-left'],
  }
  const render = (controls: { users: { id: string; name: string }[] } | null) =>
    renderToString(
      periodCloseDetailScreen(translate, {
        frame: {},
        period,
        steps: [],
        evidence: [],
        action: '/close',
        controls,
      }),
    ).replace(/<!--[^>]*-->/g, '')
  const form = render({
    users: [
      { id: 'user-chief', name: 'Lan' },
      { id: 'user-clerk', name: 'Minh' },
    ],
  })
  assert.match(form, /id="close-controls-form"/)
  assert.match(form, /name="action" value="controls"/)
  assert.match(form, /name="expectedRevision" value="4"/)
  // Each kind and each person is its own box, ticked as the period holds it.
  for (const kind of ['invoices', 'bills', 'payments', 'entries'])
    assert.match(form, new RegExp(`name="kind\\.${kind}"`))
  assert.match(form, /name="kind\.bills"[^>]*checked/)
  assert.doesNotMatch(form, /name="kind\.invoices"[^>]*checked/)
  assert.match(form, /name="poster\.user-chief"[^>]*checked/)
  assert.doesNotMatch(form, /name="poster\.user-clerk"[^>]*checked/)
  // Someone named before but no longer listed stays, so saving keeps them.
  assert.match(form, /name="poster\.user-left"[^>]*checked/)

  const read = render(null)
  assert.doesNotMatch(read, /close-controls-form/)
  assert.match(read, /account_backend\.close\.kind\.bills/)
  assert.match(read, /user-chief, user-left/)
  // A reader without the form still reads the people by name.
  const named = renderToString(
    periodCloseDetailScreen(translate, {
      frame: {},
      period,
      steps: [],
      action: '/close',
      controls: null,
      people: [{ id: 'user-chief', name: 'Lan' }],
    }),
  )
  assert.match(named, /Lan, user-left/)

  const hard = renderToString(
    periodCloseDetailScreen(translate, {
      frame: {},
      period: { ...period, state: 'hard_closed' },
      steps: [],
      action: '/close',
      controls: { users: [] },
    }),
  )
  assert.doesNotMatch(hard, /close-controls-form|account_backend\.close\.controls/)
})

test("a period close lists the installed standard's evidence item by item, named when the standard names it", () => {
  const named = ((key: string) =>
    key === 'acme_vn.closeEvidence.closing:result' ? 'Result transfer' : key) as Translator
  named.locale = 'en'
  named.has = (key) => !key.startsWith('acme_vn.') || key === 'acme_vn.closeEvidence.closing:result'
  named.resolves = named.has
  const html = renderToString(
    periodCloseDetailScreen(named, {
      frame: {},
      period: {
        id: 'close-1',
        periodKey: '2026-12',
        dateFrom: '2026-12-01',
        dateTo: '2026-12-31',
        state: 'open',
      },
      steps: [{ id: 's1', code: 'draft_moves', required: true, state: 'complete' }],
      evidence: [
        { id: 'e1', provider: 'acme_vn', code: 'closing:result', required: true, state: 'blocked' },
        { id: 'e2', provider: 'acme_vn', code: 'closing:production', required: false, state: 'blocked' },
        { id: 'e3', provider: 'acme_vn', code: 'tax:01-GTGT', required: true, state: 'passed' },
      ],
      action: '/admin/accounting/period-closes/close-1',
    }),
  )
  const text = html.replace(/<!--[^>]*-->/g, '')
  assert.match(text, /account_backend\.close\.localEvidence/)
  assert.match(text, /Result transfer/)
  // A code the standard does not name is shown as itself.
  assert.match(text, /closing:production/)
  assert.match(
    text,
    /data-tone="danger"[^>]*data-value="blocked"|data-value="blocked"[^>]*data-tone="danger"/,
  )
  assert.match(text, /account_backend\.close\.advised/)
  assert.match(text, /data-value="passed"/)
  // A completed checklist step reads as done.
  assert.match(text, /data-tone="positive"/)
  // Re-run sits in the checklist's head as a form of one button, sized by that button (#1995): a
  // default form there measures nothing as a container and pushes the button past the edge.
  assert.match(
    text,
    /data-ui="section-actions"><form id="close-refresh-form"[^>]*data-layout="inline"[^>]*data-has-fields="false"/,
  )

  const none = renderToString(
    periodCloseDetailScreen(named, {
      frame: {},
      period: {
        id: 'close-2',
        periodKey: '2026-11',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-30',
        state: 'open',
      },
      steps: [],
      evidence: [],
      action: '/admin/accounting/period-closes/close-2',
    }),
  )
  assert.doesNotMatch(none, /account_backend\.close\.localEvidence/)
})
