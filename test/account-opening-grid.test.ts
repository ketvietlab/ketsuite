import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postedGridRows } from '../packages/ketsuite/src/modules/backend/edit-grid.ts'
import { boot } from './fixtures/sale/commerce.ts'

const added = (rows: Record<string, unknown>[]) =>
  JSON.stringify({
    added: rows.map((values, index) => ({ id: `n${index}`, index, values })),
    updated: [],
    removed: [],
    order: null,
  })

test('a grid posts the rows it gained, in their order, without the ones removed again', () => {
  assert.deepEqual(postedGridRows(added([{ a: 1 }, { a: 2 }])), [{ a: 1 }, { a: 2 }])
  assert.deepEqual(
    postedGridRows(
      JSON.stringify({
        added: [
          { id: 'x', index: 1, values: { a: 'second' } },
          { id: 'y', index: 0, values: { a: 'first' } },
          { id: 'z', index: 2, values: { a: 'gone' } },
        ],
        updated: [],
        removed: ['z'],
        order: ['x', 'y'],
      }),
    ),
    [{ a: 'second' }, { a: 'first' }],
  )
  assert.equal(postedGridRows('[{"sourceKey":"1"}]'), null)
  assert.equal(postedGridRows('not json'), null)
  assert.equal(postedGridRows(undefined), null)
})

test('opening balances are entered in a grid and posted as its rows', async (t) => {
  const { app, save } = await boot(t)
  await save('account.saveAccount', { id: 'cash', code: '1111', name: 'Tiền mặt', accountType: 'asset_cash' })
  await save('account.saveAccount', { id: 'capital', code: '4111', name: 'Vốn góp', accountType: 'equity' })
  await save('account.saveJournal', { id: 'misc', name: 'Nghiệp vụ khác', code: 'MISC', type: 'general' })

  const page = await (await app.client.request('/admin/accounting/opening-balances/new?lang=vi')).text()
  assert.match(page, /data-island="backend\.ket-grid"/u)
  assert.doesNotMatch(page, /<textarea[^>]*name="lines"/u)
  assert.match(page, /Các dòng nguồn/u)

  const form = (lines: string) =>
    new URLSearchParams({
      id: 'opening-1',
      sourceName: 'Sổ cũ',
      accountingDate: '2026-01-01',
      journalId: 'misc',
      controlDebit: '1000000',
      controlCredit: '1000000',
      lines,
    }).toString()
  const post = (body: string) =>
    app.client.request('/admin/accounting/opening-balances/new?lang=vi', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    })

  const refused = await post(form('[{"sourceKey":"1"}]'))
  assert.equal(refused.status, 200)
  assert.match(await refused.text(), /Không đọc được các dòng nguồn/u)

  const created = await post(
    form(
      added([
        { sourceKey: '1', accountId: 'cash', description: 'Tiền mặt đầu kỳ', debit: 1000000, credit: null },
        { sourceKey: '2', accountId: 'capital', description: 'Vốn góp đầu kỳ', debit: null, credit: 1000000 },
      ]),
    ),
  )
  assert.equal(created.status, 303, await created.text())
  assert.match(created.headers.get('location') ?? '', /\/admin\/accounting\/opening-balances\/opening-1/u)
})
