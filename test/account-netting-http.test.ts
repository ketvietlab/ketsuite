import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }
const path = '/admin/accounting/nettings'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

type App = Awaited<ReturnType<typeof boot>>

const document = async (app: App, id: string, sale: boolean, date: string, amount: string) => {
  const created = await app.client.call<Row>('account.createInvoice', {
    id,
    journalId: sale ? 'core-sales' : 'core-purchases',
    moveType: sale ? 'out_invoice' : 'in_invoice',
    partnerId: 'both-ways',
    invoiceDate: `${date}T00:00:00.000Z`,
    accountingDate: date,
    documentDate: date,
    description: id,
    quantity: '1',
    priceUnit: amount,
    lineAccountId: sale ? 'core-revenue' : 'core-expense',
    counterpartAccountId: sale ? 'core-receivable' : 'core-payable',
  })
  assert.equal(created.value.ok, true, JSON.stringify(created.value))
  assert.equal((await app.client.call<Row>('account.postMove', { id })).value.ok, true)
}

test('netting previews the spread, posts one entry and reverses back to open documents', async (t) => {
  const app = await boot(t)

  // Nobody open on both sides yet: the screen says why instead of offering an empty picker.
  const empty = await app.client.get(`${path}?lang=vi`)
  assert.equal(empty.status, 200)
  const emptyHtml = await empty.text()
  assert.match(emptyHtml, /Chưa có đối tác nào để bù trừ/)
  assert.doesNotMatch(emptyHtml, /netting-preview-form/)

  await app.client.call('partner.savePartner', {
    id: 'both-ways',
    kind: 'company',
    name: 'Đối tác hai chiều',
  })
  await document(app, 'net-invoice', true, '2026-03-02', '700000')
  await document(app, 'net-bill', false, '2026-03-05', '400000')

  const chosen = await app.client.get(`${path}?lang=vi`)
  const chosenHtml = await chosen.text()
  assert.match(chosenHtml, /id="netting-preview-form"/)
  assert.match(chosenHtml, /Đối tác hai chiều/)
  assert.doesNotMatch(chosenHtml, /netting-post-form/)

  const previewed = await app.client.get(`${path}?lang=vi&partnerId=both-ways&accountingDate=2026-03-31`)
  const previewHtml = await previewed.text()
  assert.match(previewHtml, /Phải thu được bù/)
  assert.match(previewHtml, /Phải trả được bù/)
  assert.match(previewHtml, /SAL\/2026\/00001/)
  assert.match(previewHtml, /PUR\/2026\/00001/)
  assert.match(previewHtml, /id="netting-post-form"/)
  assert.match(previewHtml, /name="amount" value="400000"/)
  // The only general journal is preselected and carried into the posting form.
  assert.match(previewHtml, /name="journalId" value="core-general"/)

  // With two general journals and none chosen, the screen asks for one instead of posting blind.
  await app.client.call('account.saveJournal', {
    id: 'netting-second',
    name: 'Second',
    code: 'GEN2',
    type: 'general',
  })
  const unchosen = await (await app.client.get(`${path}?lang=vi&partnerId=both-ways`)).text()
  assert.match(unchosen, /Chọn sổ nhật ký rồi bấm Xem phân bổ/)
  assert.doesNotMatch(unchosen, /netting-post-form/)

  // Asking for more than the smaller side is refused on the preview, with the maximum.
  const tooMuch = await app.client.get(`${path}?lang=vi&partnerId=both-ways&amount=500000`)
  const tooMuchHtml = await tooMuch.text()
  assert.match(tooMuchHtml, /vượt quá bên nhỏ hơn/)
  assert.doesNotMatch(tooMuchHtml, /netting-post-form/)

  const crossSite = await app.client.post(
    path,
    new URLSearchParams({ action: 'post', id: 'net-forged', partnerId: 'both-ways' }),
    { ...post, headers: { ...post.headers, origin: 'https://attacker.example' } },
  )
  assert.equal(crossSite.status, 403)

  const posted = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({
      action: 'post',
      id: 'net-http',
      partnerId: 'both-ways',
      journalId: 'core-general',
      amount: '400000',
      accountingDate: '2026-03-31',
    }),
    post,
  )
  assert.equal(posted.status, 303)
  assert.equal(posted.headers.get('location'), '/admin/accounting/entries/net-http?lang=vi')
  const moves = (await app.client.call<Row[]>('account.listMoves', {})).value
  assert.equal(moves.find((move) => move.id === 'net-invoice')?.paymentState, 'partial')
  assert.equal(moves.find((move) => move.id === 'net-bill')?.paymentState, 'paid')

  // The bill is settled, so the partner no longer appears.
  assert.match(await (await app.client.get(`${path}?lang=vi`)).text(), /Chưa có đối tác nào để bù trừ/)

  // Reversing the entry from its own page reopens both documents.
  const entry = await app.client.get('/admin/accounting/entries/net-http?lang=vi')
  assert.equal(entry.status, 200)
  const reversed = await app.client.post(
    '/admin/accounting/entries/net-http?lang=vi',
    new URLSearchParams({ action: 'reverse', reversalId: 'net-http-reversal' }),
    post,
  )
  assert.equal(reversed.status, 303, await reversed.text())
  const after = (await app.client.call<Row[]>('account.listMoves', {})).value
  assert.equal(after.find((move) => move.id === 'net-invoice')?.paymentState, 'not_paid')
  assert.equal(after.find((move) => move.id === 'net-bill')?.paymentState, 'not_paid')
  assert.match(await (await app.client.get(`${path}?lang=vi`)).text(), /Đối tác hai chiều/)
})
