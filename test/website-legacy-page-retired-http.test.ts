import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * The legacy `website.Page` model is served only while a deployment has no Studio site at all
 * (`__legacy__`). Once a site exists, the public path resolves Studio entries, so a page written
 * through `website.savePage` is stored and never shown. A seed or tool that still writes pages
 * that way loses them silently; the same page as an entry is what a visitor gets.
 */
test('legacy pages: once a site exists only Studio entries are served, never website.Page', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'legacy-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const visit = async (path: string) => {
    const response = await app.client.anonymous().get(path)
    return { status: response.status, html: await response.text() }
  }

  const legacy = await fixture('website.savePage', {
    id: 'page-legacy',
    path: '/trang-cu',
    title: 'Trang cũ',
    layout: [{ id: 'legacy-text', type: 'website.rich_text', settings: { body: 'Nội dung trang cũ' } }],
  })
  assert.equal(legacy.ok, true, JSON.stringify(legacy))
  await fixture('website.publishPage', { id: 'page-legacy', published: true })
  const unseen = await visit('/trang-cu')
  assert.equal(unseen.status, 404)
  assert.doesNotMatch(unseen.html, /Nội dung trang cũ/)

  const publisher = app.client.anonymous()
  await publisher.login({ login: 'studio-publisher', password: 'studio-local' })
  const call = async (fn: string, input: Row) => {
    const response = await publisher.post('/website/api/' + fn, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json()) as { value: Row }
    assert.equal(response.status, 200, `${fn}: ${JSON.stringify(body)}`)
    return body.value
  }
  const saved = await call('website.saveEntry', {
    id: 'page-legacy-entry',
    siteId: 'site-a',
    type: 'page',
    title: 'Trang cũ',
    path: '/trang-cu',
    layout: [{ id: 'entry-text', type: 'website.rich_text', settings: { body: 'Nội dung trang cũ' } }],
    expectedRevisionId: null,
  })
  await call('website.publishEntry', {
    id: 'page-legacy-entry',
    expectedRevisionId: saved.revisionId,
    publishAt: null,
  })
  const served = await visit('/trang-cu')
  assert.equal(served.status, 200)
  assert.match(served.html, /Nội dung trang cũ/)
})
