import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createQueue, defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'
import { campaignParams, contactOf } from '../packages/website-client/client/visit.mjs'
import { readConsent } from '../packages/website-client/client/consent.mjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const VISITOR_KEY = 'k'.repeat(32)
const NOTICE = 'Chúng tôi ghi lại trang bạn xem và nút gọi bạn bấm.'

test('the visit script reads campaign params and contact links, and the consent cookie by version', () => {
  assert.deepEqual(campaignParams('?gclid=abc&utm_source=google&x=1'), { gclid: 'abc', utm_source: 'google' })
  assert.equal(campaignParams('?q=cam'), null)
  assert.deepEqual(contactOf('tel:0901234567', 'https://a.test/'), { channel: 'phone', target: '0901234567' })
  assert.deepEqual(contactOf('https://zalo.me/0901234567', 'https://a.test/'), {
    channel: 'zalo',
    target: 'zalo.me/0901234567',
  })
  assert.equal(contactOf('/san-pham', 'https://a.test/'), null)
  const doc = { cookie: 'other=1; kv_visit_consent=2%3Ayes' } as unknown as Document
  assert.equal(readConsent(doc, 2), 'yes')
  assert.equal(readConsent(doc, 3), null, 'a new notice asks again')
})

test('commerce site visits need the visitor to agree to the current notice', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'visit-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  await fixture('website.saveStudioStyle', {
    siteId: 'site-a',
    expectedRevisionId: 'initial',
    values: { preset: 'retail' },
  })
  const entry = (await fixture('website.getEntry', { id: 'page-site-a' })).entry as Row
  await fixture('website.publishEntry', { id: entry.id, expectedRevisionId: entry.revisionId })

  const visitor = app.client.anonymous()
  const json = { headers: { 'content-type': 'application/json' } }
  const start = (body: Row, headers: Record<string, string> = {}) =>
    visitor.post('/_website/visit', JSON.stringify(body), { headers: { ...json.headers, ...headers } })

  // Off by default: no banner, no script, and the endpoint does not exist for the site.
  const off = await (await visitor.get('/')).text()
  assert.doesNotMatch(off, /data-website-consent|data-website-visit/)
  assert.equal((await start({ visitorKey: VISITOR_KEY, consentVersion: 1, path: '/' })).status, 404)

  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  const send = async (fn: string, input: Row) => {
    const response = await designer.post('/website/api/' + fn, JSON.stringify(input), json)
    return { status: response.status, ...((await response.json()) as { value: Row }) }
  }
  const saveSite = async (values: Row) => {
    const site = (await send('website_studio.siteReadiness', { siteId: 'site-a' })).value.site as Row
    return send('website_studio.saveResource', {
      siteId: site.id,
      kind: 'sites',
      id: site.id,
      expectedRevisionId: site.revisionId,
      values,
    })
  }
  const refused = await saveSite({ visitConsent: true, visitConsentNotice: '' })
  assert.notEqual(refused.status, 200, 'tracking cannot be switched on without a notice')
  const saved = await saveSite({ visitConsent: true, visitConsentNotice: NOTICE })
  assert.equal(saved.status, 200, JSON.stringify(saved))
  const resolved = await fixture('website.resolveSite', { host: '127.0.0.1' })
  assert.equal(resolved.visitConsent, true)
  assert.equal(resolved.visitConsentVersion, 1)

  const page = await visitor.get('/')
  const html = await page.text()
  assert.match(
    html,
    /data-website-consent="" hidden=""/,
    'hidden until the script knows the visitor has not answered',
  )
  assert.ok(html.includes(NOTICE))
  assert.match(html, /src="\/_ket\/asset\/website_backend\/visit\.mjs" data-website-visit="1"/)
  const scriptSrc = page.headers
    .get('content-security-policy')!
    .split(';')
    .find((d: string) => d.includes('script-src'))!
  assert.doesNotMatch(scriptSrc, /unsafe-inline/)
  for (const asset of ['visit.mjs', 'consent.mjs'])
    assert.equal((await visitor.get('/_ket/asset/website_backend/' + asset)).status, 200, asset)
  assert.doesNotMatch(await (await designer.get('/')).text(), /data-website-consent|data-website-visit/)

  // An agreement given to an older notice no longer holds.
  assert.equal((await start({ visitorKey: VISITOR_KEY, consentVersion: 2, path: '/' })).status, 409)
  assert.equal((await start({ visitorKey: 'short', consentVersion: 1, path: '/' })).status, 422)
  assert.equal(
    (await start({ visitorKey: VISITOR_KEY, consentVersion: 1, path: '/' }, { origin: 'https://other.test' }))
      .status,
    403,
  )
  assert.equal(
    (
      await designer.post(
        '/_website/visit',
        JSON.stringify({ visitorKey: VISITOR_KEY, consentVersion: 1, path: '/' }),
        json,
      )
    ).status,
    403,
    'staff are not visitors',
  )

  const started = await start({
    visitorKey: VISITOR_KEY,
    consentVersion: 1,
    path: '/?gclid=secret#top',
    referrerHost: 'www.google.com',
    params: { gclid: 'Cj0KCQ-test_1', utm_source: 'google', fbclid: 'bad value!' },
  })
  assert.equal(started.status, 200)
  const visitId = String(((await started.json()) as Row).id)
  const q = app.adapter!.quoteIdent.bind(app.adapter)
  const visits = await app.adapter!.all(`SELECT * FROM ${q(tableNameFor('website.Visit'))}`)
  assert.equal(visits.length, 1)
  const visit = visits[0] as Row
  assert.equal(visit.landingPath, '/')
  assert.equal(visit.referrerHost, 'www.google.com')
  assert.equal(visit.visitorDigest, createHash('sha256').update(`site-a\0${VISITOR_KEY}`).digest('hex'))
  assert.ok(!JSON.stringify(visits).includes(VISITOR_KEY), 'the raw visitor key is never stored')
  const clickIds = typeof visit.clickIds === 'string' ? JSON.parse(visit.clickIds) : visit.clickIds
  assert.deepEqual(clickIds, { gclid: 'Cj0KCQ-test_1' })

  const event = (id: string, body: Row) =>
    visitor.post(`/_website/visit/${encodeURIComponent(id)}/events`, JSON.stringify(body), json)
  assert.equal(
    (
      await event(visitId, {
        visitorKey: 'x'.repeat(32),
        consentVersion: 1,
        kind: 'contact',
        path: '/',
        channel: 'phone',
        target: 'tel:1',
      })
    ).status,
    422,
    'another browser cannot write into this visit',
  )
  const called = await event(visitId, {
    visitorKey: VISITOR_KEY,
    consentVersion: 1,
    kind: 'contact',
    path: '/',
    channel: 'phone',
    target: '090 123 4567',
  })
  assert.equal(called.status, 200)
  const events = (await app.adapter!.all(
    `SELECT * FROM ${q(tableNameFor('website.VisitEvent'))} WHERE ${q('kind')} = 'contact'`,
  )) as Row[]
  assert.equal(events.length, 1)
  assert.equal(events[0]!.channel, 'phone')
  assert.equal(events[0]!.target, '0901234567')

  await app.adapter!.run(`UPDATE ${q(tableNameFor('website.VisitRateLimit'))} SET ${q('count')} = 120`)
  assert.equal((await start({ visitorKey: VISITOR_KEY, consentVersion: 1, path: '/' })).status, 429)

  // New wording asks again; an unchanged one does not.
  await saveSite({ visitConsentNotice: NOTICE })
  assert.equal((await fixture('website.resolveSite', { host: '127.0.0.1' })).visitConsentVersion, 1)
  await saveSite({ visitConsentNotice: NOTICE + ' Thêm nút Zalo.' })
  assert.equal((await fixture('website.resolveSite', { host: '127.0.0.1' })).visitConsentVersion, 2)
  assert.match(await (await visitor.get('/')).text(), /data-website-visit="2"/)

  await saveSite({ visitConsent: false })
  const disabled = await (await visitor.get('/')).text()
  assert.doesNotMatch(disabled, /data-website-consent|data-website-visit/)
})

const retentionApp = defineDeployment({
  name: 'website_visit_retention_app',
  companies: true,
  headless: true,
  modules: [address, partner, website, paperTheme],
  serve: {},
  worker: { queues: { default: 1 } },
})

test('visit retention: the daily sweep erases expired visits and their events, and nothing else', async (t) => {
  const deployment = await createTestDeployment(retentionApp)
  t.after(() => deployment.close())
  const visitIds: Record<string, string> = {}
  for (const company of ['acme', 'globex']) {
    const scope = { company, branches: null }
    await deployment.fixture.call(
      'website.saveSite',
      {
        id: `${company}-site`,
        name: company,
        title: company,
        defaultLocale: 'vi',
        theme: 'theme_paper',
        visitConsent: true,
        visitConsentNotice: NOTICE,
      },
      { scope },
    )
    const visit = await deployment.fixture.call<{ ok: boolean; id: string }>(
      'website.recordVisit',
      { siteId: `${company}-site`, visitorKey: VISITOR_KEY, consentVersion: 1, path: '/' },
      { scope },
    )
    assert.ok(visit.value.ok, JSON.stringify(visit.value))
    visitIds[company] = visit.value.id
  }
  const q = (name: string) => `"${tableNameFor(name)}"`
  await deployment.fixture.withTenant('', async (tenant) => {
    await tenant.adapter.run(`UPDATE ${q('website.Visit')} SET "expiresAt" = ? WHERE "id" = ?`, [
      new Date(Date.now() - 86_400_000).toISOString(),
      visitIds.acme,
    ])
    const queue = await createQueue(tenant.adapter)
    await queue.enqueue('website.visitRetentionSweep', {}, { queue: 'default', maxAttempts: 1 })
  })
  await deployment.drainJobs()
  const completed = deployment.records.of('job_completed').map((record) => record.fn)
  assert.equal(
    completed.filter((fn) => fn === 'website.purgeExpiredVisits').length,
    2,
    'one pass per company',
  )
  await deployment.fixture.withTenant('', async (tenant) => {
    const visits = (await tenant.adapter.all(`SELECT "id" FROM ${q('website.Visit')}`)) as Row[]
    assert.deepEqual(
      visits.map((row) => row.id),
      [visitIds.globex],
      'the expired visit is gone, the live one stays',
    )
    const events = (await tenant.adapter.all(`SELECT "visitId" FROM ${q('website.VisitEvent')}`)) as Row[]
    assert.ok(
      events.every((row) => row.visitId === visitIds.globex),
      'no event outlives its visit',
    )
  })
})
