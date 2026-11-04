import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQueue } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import sharp from 'sharp'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * A category's thumbnail and cover are uploads the term owns: staged by whoever may save the
 * term, claimed in the save's transaction, shown on the term's public page while the term is in
 * use, and collected once no term names them. An upload for a page cannot become a term's image.
 */
test('Studio category images: upload, claim on save, public cover and collection', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce', worker: true })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'term-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: name, password: 'studio-local' })
    return client
  }
  const editor = await login('studio-editor')
  const reader = await login('studio-reader')
  const call = async (name: string, input: Row) => {
    const response = await editor.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    return { status: response.status, ...((await response.json()) as { message?: string; value: Row }) }
  }
  const pixels = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#497b65' } })
    .png()
    .toBuffer()
  const form = () => {
    const data = new FormData()
    data.append('file', new Blob([new Uint8Array(pixels)], { type: 'image/png' }), 'cover.png')
    return data
  }
  const upload = async (owner: string, field: string, as = editor, query = '&owner=term') => {
    const response = await as.post(`/website/images/${owner}/${field}?site=site-a${query}`, form())
    return { status: response.status, value: (await response.json().catch(() => null)) as Row }
  }
  const uploaded = async (owner: string, field: string) => {
    const result = await upload(owner, field)
    assert.equal(result.status, 201, JSON.stringify(result))
    return String(result.value.url)
  }

  // Only someone who may save terms uploads, and only the term's own two images.
  assert.equal((await upload('cat-tea', 'cover', reader)).status, 403)
  assert.equal((await upload('cat-tea', 'image')).status, 403)
  // An upload for a page is not a term's image, and the term cannot take it.
  const forPage = await upload('cat-tea-page', 'image', editor, '')
  assert.equal(forPage.status, 201, JSON.stringify(forPage))

  const thumbnail = await uploaded('cat-tea', 'thumbnail')
  const cover = await uploaded('cat-tea', 'cover')
  const values = (more: Row = {}) => ({
    title: 'Trà xanh',
    slug: 'tra-xanh',
    taxonomyType: 'category',
    description: 'Lá trà non',
    thumbnail,
    thumbnailAlt: '',
    cover,
    coverAlt: 'Đồi chè buổi sáng',
    indexing: 'index',
    ...more,
  })
  const save = (more: Row = {}, expectedRevisionId: string | null = null) =>
    call('website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'taxonomy',
      id: 'cat-tea',
      expectedRevisionId,
      values: values(more),
    })

  const noAlt = await save({ coverAlt: '' })
  assert.notEqual(noAlt.status, 200)
  assert.equal(noAlt.message, 'Ảnh bìa cần có mô tả cho người không xem được ảnh.')
  const stolen = await save({ cover: String(forPage.value.url) })
  assert.notEqual(stolen.status, 200)
  assert.match(String(stolen.message), /không thuộc chuyên mục\/thẻ này/)
  // The refused save left nothing behind: the term was not created.
  assert.equal((await fixture('website.getTaxonomyTerm', { id: 'cat-tea' })) ?? null, null)

  const saved = await save()
  assert.equal(saved.status, 200, JSON.stringify(saved))
  const term = (await fixture('website.getTaxonomyTerm', { id: 'cat-tea' })) as Row
  assert.deepEqual(term.images, { thumbnail, thumbnailAlt: '', cover, coverAlt: 'Đồi chè buổi sáng' })
  // Opening the term again shows what was saved, not empty image fields.
  const read = await call('website_studio.getResource', { siteId: 'site-a', kind: 'taxonomy', id: 'cat-tea' })
  assert.equal(read.value.cover, cover)
  assert.equal(read.value.coverAlt, 'Đồi chè buổi sáng')
  assert.equal(read.value.thumbnail, thumbnail)

  // The public page shows the cover with its description and shares the thumbnail.
  const page = await app.client.anonymous().get('/category/tra-xanh')
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(
    html,
    new RegExp(`<img class="wt-public-archive__cover" src="${cover}" alt="Đồi chè buổi sáng">`),
  )
  assert.match(html, new RegExp(`<meta property="og:image" content="[^"]*${thumbnail}">`))
  assert.equal((await app.client.anonymous().get(cover)).status, 200)
  assert.equal((await app.client.anonymous().get(thumbnail)).status, 200)

  // A new cover replaces the old one; the old bytes go once the sweep finds no term naming them.
  const nextCover = await uploaded('cat-tea', 'cover')
  const replaced = await save({ cover: nextCover }, String(saved.value.revisionId ?? term.revisionId))
  assert.equal(replaced.status, 200, JSON.stringify(replaced))
  const sweep = async () => {
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        `UPDATE website_image_asset SET "expiresAt" = '2000-01-01T00:00:00Z', "unreferencedAt" = CASE WHEN "unreferencedAt" IS NULL THEN NULL ELSE '2000-01-01T00:00:00Z' END`,
      )
      await (await createQueue(adapter)).enqueue(
        'website.collectImages',
        {},
        { queue: 'default', maxAttempts: 1 },
      )
    })
    await app.drainJobs()
  }
  // An archived term leaves the site, so its images do too, but it keeps them for a restore.
  const current = (await fixture('website.getTaxonomyTerm', { id: 'cat-tea' })) as Row
  const archived = await call('website_studio.archiveResource', {
    siteId: 'site-a',
    kind: 'taxonomy',
    id: 'cat-tea',
    expectedRevisionId: current.revisionId,
    confirmed: true,
  })
  assert.equal(archived.status, 200, JSON.stringify(archived))
  assert.equal((await app.client.anonymous().get(nextCover)).status, 404)
  await sweep()
  await sweep()
  assert.equal((await editor.get(cover)).status, 404, 'the replaced cover is collected')
  assert.equal((await editor.get(nextCover)).status, 200, 'the saved cover is kept')
  assert.equal((await editor.get(thumbnail)).status, 200, 'the thumbnail is kept')
  assert.equal((await editor.get(String(forPage.value.url))).status, 404, 'the unclaimed page upload expires')
})
