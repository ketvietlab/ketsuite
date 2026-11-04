import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQueue } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import sharp from 'sharp'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * Each language is its own entry, linked to the others by `translationGroupId`: a translation is
 * created from its source, published on its own under its own path, may keep the source's slug,
 * and may draw the source's images. One group holds one entry per language.
 */
test('translations: create, publish each language alone, link, unlink and migrate', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce', worker: true })
  t.after(() => app.close())
  const site = {
    id: 'site-a',
    name: 'site-a',
    title: 'site-a',
    theme: 'theme_paper',
    defaultLocale: 'vi',
    active: true,
  }
  await fixture('website.saveSite', { ...site, locales: ['vi', 'en', 'ja'] }, 'studio-a')
  await fixture('website.saveDomain', { id: 'tr-domain', siteId: 'site-a', host: '127.0.0.1', primary: true })
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: name, password: 'studio-local' })
    return async (fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { message?: string; value: Row }) }
    }
  }
  const editor = await login('studio-editor')
  const publisher = await login('studio-publisher')
  const ok = async (fn: string, input: Row, as = editor) => {
    const result = await as(fn, input)
    assert.equal(result.status, 200, `${fn}: ${JSON.stringify(result)}`)
    return result.value
  }
  const refused = async (fn: string, input: Row, message: RegExp) => {
    const result = await editor(fn, input)
    assert.notEqual(result.status, 200, JSON.stringify(result))
    assert.match(String(result.message), message)
  }
  const visit = async (path: string) => {
    const response = await app.client.anonymous().get(path)
    return { status: response.status, html: await response.text() }
  }

  // A Vietnamese post with an image it uploaded.
  const pixels = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#497b65' } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(pixels)], { type: 'image/png' }), 'cover.png')
  const editorClient = app.client.anonymous()
  await editorClient.login({ login: 'studio-editor', password: 'studio-local' })
  const uploaded = await editorClient.post('/website/images/post-vi/image?site=site-a', form)
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const image = String(((await uploaded.json()) as Row).url)
  const layout = [
    {
      id: 'hero-text',
      type: 'website.rich_text',
      settings: { heading: 'Trà xanh mùa mới', body: 'Lá trà non hái sớm' },
    },
    { id: 'photo-main', type: 'website.image', settings: { image, alt: 'Đồi chè' } },
  ]
  await ok('website.saveEntry', {
    id: 'post-vi',
    siteId: 'site-a',
    type: 'post',
    title: 'Trà xanh mùa mới',
    path: '/blog/tra-xanh',
    slug: 'tra-xanh',
    layout,
    expectedRevisionId: null,
  })

  // The English translation keeps the slug, gains the prefix and starts as a draft of its own.
  const en = await ok('website.createTranslation', { id: 'post-vi', locale: 'en', newId: 'post-en' })
  assert.equal(en.id, 'post-en')
  assert.equal(en.locale, 'en')
  assert.equal(en.path, '/en/blog/tra-xanh')
  assert.equal(en.status, 'draft')
  assert.equal(en.translationGroupId, 'post-vi')
  // A retried request returns the same translation instead of a second one.
  assert.equal(
    (await ok('website.createTranslation', { id: 'post-vi', locale: 'en', newId: 'post-en' })).id,
    'post-en',
  )
  await refused('website.createTranslation', { id: 'post-vi', locale: 'en' }, /đã có bản dịch/)
  await refused('website.createTranslation', { id: 'post-vi', locale: 'fr' }, /chưa được bật/)
  // Saving the source in a language its group already has is refused the same way.
  const vi = (await fixture('website.getEntry', { id: 'post-vi' })) as { entry: Row }
  await refused(
    'website.saveEntry',
    {
      id: 'post-vi',
      siteId: 'site-a',
      type: 'post',
      title: 'Trà xanh mùa mới',
      path: '/blog/tra-xanh',
      slug: 'tra-xanh',
      layout,
      locale: 'en',
      expectedRevisionId: vi.entry.currentRevisionId,
    },
    /đã có bản dịch/,
  )

  // `structure` copies the layout with its words emptied, images and links kept.
  await ok('website.createTranslation', { id: 'post-en', locale: 'ja', copy: 'structure', newId: 'post-ja' })
  const ja = (await fixture('website.getEntry', { id: 'post-ja' })) as { entry: Row; revision: Row }
  assert.equal(ja.entry.path, '/ja/blog/tra-xanh')
  const jaLayout = ja.revision.layout as Array<{ settings: Row }>
  assert.equal(jaLayout[0]!.settings.heading, '')
  assert.equal(jaLayout[1]!.settings.image, image)

  const listed = (await ok('website.listTranslations', { id: 'post-en' })) as unknown as Row[]
  assert.deepEqual(
    listed.map((row) => [row.id, row.locale]),
    [
      ['post-vi', 'vi'],
      ['post-en', 'en'],
      ['post-ja', 'ja'],
    ],
  )

  // Only the English one goes live; the Vietnamese draft stays unseen, and the shared image is public.
  await ok(
    'website.publishEntry',
    {
      id: 'post-en',
      expectedRevisionId: ((await fixture('website.getEntry', { id: 'post-en' })) as { entry: Row }).entry
        .currentRevisionId,
      publishAt: null,
    },
    publisher,
  )
  const live = await visit('/en/blog/tra-xanh')
  assert.equal(live.status, 200)
  assert.match(live.html, /Trà xanh mùa mới/)
  assert.equal((await visit('/blog/tra-xanh')).status, 404)
  assert.equal(
    (await app.client.anonymous().get(image)).status,
    200,
    'the translation publishes the image it draws',
  )

  // A language content is written in stays on the site.
  const removed = (
    await app.fixture.call<Row>(
      'website.saveSite',
      { ...site, locales: ['vi', 'ja'] },
      { scope: { company: 'studio-a', branches: null } },
    )
  ).value
  assert.equal((removed as Row).ok, false)
  assert.equal(((removed as Row).errors as Row[])[0]!.message, 'website.error.localeInUse')

  // Two pages written apart can be linked as translations, and unlinked again.
  const page = (id: string, path: string, locale: string) =>
    ok('website.saveEntry', {
      id,
      siteId: 'site-a',
      type: 'page',
      title: id,
      path,
      slug: path.split('/').at(-1),
      layout: [],
      locale,
      expectedRevisionId: null,
    })
  await page('about-vi', '/gioi-thieu', 'vi')
  await page('about-en', '/en/about', 'en')
  await page('contact-en', '/en/contact', 'en')
  assert.equal(
    (await ok('website.linkTranslation', { id: 'about-vi', targetId: 'about-en' })).translationGroupId,
    'about-vi',
  )
  await refused('website.linkTranslation', { id: 'about-vi', targetId: 'contact-en' }, /đã có bản dịch/)
  await refused('website.linkTranslation', { id: 'about-vi', targetId: 'post-ja' }, /cùng loại nội dung/)
  assert.equal(((await ok('website.listTranslations', { id: 'about-en' })) as unknown as Row[]).length, 2)
  await ok('website.unlinkTranslation', { id: 'about-vi' })
  assert.equal(((await ok('website.listTranslations', { id: 'about-en' })) as unknown as Row[]).length, 1)
  assert.equal(((await ok('website.listTranslations', { id: 'about-vi' })) as unknown as Row[]).length, 1)

  // Rows saved before translations read as the default language and are named by the migration.
  await app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE website_entry SET locale = NULL, "translationGroupId" = NULL WHERE id = 'page-site-a'`,
    )
  })
  const vietnamese = (await fixture('website.listEntries', {
    siteId: 'site-a',
    locale: 'vi',
  })) as unknown as Row[]
  assert.ok(vietnamese.some((row) => row.id === 'page-site-a' && row.locale === 'vi'))
  assert.ok(!vietnamese.some((row) => row.id === 'post-en'))
  const migrate = async (dryRun: boolean) => {
    await app.fixture.withTenant('', async ({ adapter }) => {
      await (await createQueue(adapter)).enqueue(
        'website.migrateEntryLocales',
        { dryRun },
        { queue: 'default', maxAttempts: 1 },
      )
    })
    await app.drainJobs()
    return app.fixture.withTenant('', async ({ adapter }) =>
      (
        await adapter.all(`SELECT locale, "translationGroupId" FROM website_entry WHERE id = 'page-site-a'`)
      ).map((row) => ({ ...row })),
    )
  }
  assert.deepEqual(await migrate(true), [{ locale: null, translationGroupId: null }])
  assert.deepEqual(await migrate(false), [{ locale: 'vi', translationGroupId: 'page-site-a' }])
})
