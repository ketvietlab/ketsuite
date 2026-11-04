import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const doc = (text: string, link: string) =>
  JSON.stringify([{ type: 'p', delta: [{ insert: text, attributes: { link } }] }])

/**
 * Archiving a page leaves whatever links to it pointing at nothing: the header menu and other pages.
 * The history screen names them before the confirmation, and archiving stays the publisher's.
 */
test('Studio archive: the confirmation names what links to the page, and only a publisher archives', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  const client = async (login: string) => {
    const c = app.client.anonymous()
    await c.login({ login, password: 'studio-local' })
    return async (name: string, input: Row) => {
      const response = await c.post('/website/api/' + name, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row }) }
    }
  }
  const page = (id: string, title: string, path: string, layout: unknown[] = [], fields?: Row) =>
    fixture('website.saveEntry', {
      id,
      siteId: 'site-a',
      type: id.startsWith('post') ? 'website.post' : 'website.page',
      slug: path.slice(1),
      title,
      path,
      layout,
      ...(fields ? { fields } : {}),
    })
  const target = await page('about', 'Giới thiệu', '/gioi-thieu')
  await fixture('website.publishEntry', { id: 'about', expectedRevisionId: target.revisionId })
  const cta = (href: string) => [
    { id: 'node-cta', type: 'website.callout', settings: { heading: 'Xem', ctaLabel: 'Xem', ctaHref: href } },
  ]
  const home = await page('home-links', 'Trang chủ', '/trang-chu', cta('/gioi-thieu#doi-ngu'))
  await fixture('website.publishEntry', { id: 'home-links', expectedRevisionId: home.revisionId })
  await page('post-links', 'Bài có liên kết', '/bai-lien-ket', [], {
    bodyDoc: doc('đọc thêm', '/gioi-thieu?ref=bai'),
  })
  await page('unrelated', 'Trang khác', '/khac', cta('/gioi-thieu-cu'))
  const trashed = await page('trashed-links', 'Trang đã bỏ', '/da-bo', cta('/gioi-thieu'))
  await fixture('website.trashEntry', { id: 'trashed-links', expectedRevisionId: trashed.revisionId })
  await fixture('website_menu.addMenuItem', {
    id: 'menu-about',
    siteId: 'site-a',
    label: 'Về chúng tôi',
    href: '/gioi-thieu',
    position: 0,
  })

  const publisher = await client('studio-publisher')
  const history = await publisher('website_studio.entryHistory', { id: 'about', siteId: 'site-a' })
  assert.equal(history.status, 200, JSON.stringify(history))
  assert.deepEqual(
    (history.value.usage as Row[]).map((u) => [u.id, u.type]),
    [
      ['menu-about', 'menu'],
      ['post-links', 'draft'],
      ['home-links', 'publication'],
    ],
    'a link with an anchor or a query counts; a longer path and a trashed page do not',
  )

  // An editor may change the page and archive a draft, but not take a live page off the site.
  const editor = await client('studio-editor')
  const draft = await page('draft-only', 'Nháp', '/nhap')
  const archivedDraft = await editor('website_studio.setEntryArchived', {
    id: 'draft-only',
    siteId: 'site-a',
    archived: true,
    expectedRevisionId: draft.revisionId,
  })
  assert.equal(archivedDraft.status, 200, JSON.stringify(archivedDraft))
  const refused = await editor('website_studio.setEntryArchived', {
    id: 'about',
    siteId: 'site-a',
    archived: true,
    expectedRevisionId: target.revisionId,
  })
  assert.equal(refused.status, 403, JSON.stringify(refused))
  const stillLive = (await publisher('website.getEntry', { id: 'about' })).value.entry as Row
  assert.equal(stillLive.publishedRevisionId, target.revisionId, 'the refusal leaves the page live')
  const archived = await publisher('website_studio.setEntryArchived', {
    id: 'about',
    siteId: 'site-a',
    archived: true,
    expectedRevisionId: target.revisionId,
  })
  assert.equal(archived.status, 200, JSON.stringify(archived))
  // Back from the archive as a draft: nothing it used to say goes live again by itself.
  const restored = await publisher('website_studio.setEntryArchived', {
    id: 'about',
    siteId: 'site-a',
    archived: false,
    expectedRevisionId: target.revisionId,
  })
  assert.equal(restored.status, 200, JSON.stringify(restored))
  const entry = (await publisher('website.getEntry', { id: 'about' })).value.entry as Row
  assert.deepEqual([entry.trashed, entry.state ?? entry.status], [false, 'draft'])
})
