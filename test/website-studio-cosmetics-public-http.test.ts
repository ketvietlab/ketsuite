import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * The cosmetics preset as a visitor meets it. A designer chooses it and the public pages carry the
 * preset and its settings on the site root that the bundled stylesheet keys on. Appearance is
 * site-wide and read at delivery while content stays frozen: a page published before the choice
 * takes the new look at once, with the words it was published with.
 */
test('Studio style: the cosmetics preset reaches every public page at once, content unchanged', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'lanh-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return async (fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      const body = (await response.json()) as { value: Row }
      assert.equal(response.status, 200, `${fn}: ${JSON.stringify(body)}`)
      return body.value
    }
  }
  const designer = await login('designer')
  const publisher = await login('publisher')
  const publish = async (id: string, title: string, path: string, expectedRevisionId: string | null) => {
    const saved = await publisher('website.saveEntry', {
      id,
      siteId: 'site-a',
      type: 'page',
      title,
      path,
      layout: [{ id: `${id}-text`, type: 'website.rich_text', settings: { body: title } }],
      expectedRevisionId,
    })
    await publisher('website.publishEntry', { id, expectedRevisionId: saved.revisionId, publishAt: null })
    return String(saved.revisionId)
  }
  const visit = async (path: string) => (await app.client.anonymous().get(path)).text()
  const siteRoot = (html: string) => html.match(/<div class="wt-site"[^>]*>/)?.[0] ?? ''

  const earlier = await publish('page-earlier', 'Trang cũ', '/trang-cu', null)
  assert.doesNotMatch(siteRoot(await visit('/trang-cu')), /data-theme-preset="cosmetics"/)

  const style = await designer('website_studio.getResource', {
    siteId: 'site-a',
    kind: 'themes',
    id: 'site-a',
  })
  await designer('website_studio.saveResource', {
    siteId: 'site-a',
    kind: 'themes',
    id: 'site-a',
    expectedRevisionId: style.revisionId,
    values: {
      preset: 'cosmetics',
      accent: 'indigo',
      font: 'serif',
      spacing: 'comfortable',
      buttons: 'rounded',
    },
  })
  await publish('page-lanh', 'Chăm sóc da mỗi ngày', '/cham-soc-da', null)

  const root = siteRoot(await visit('/cham-soc-da'))
  for (const [attribute, value] of [
    ['data-theme-preset', 'cosmetics'],
    ['data-accent', 'indigo'],
    ['data-font', 'serif'],
    ['data-spacing', 'comfortable'],
    ['data-buttons', 'rounded'],
  ])
    assert.match(root, new RegExp(`${attribute}="${value}"`), attribute)
  // The stylesheet every public page links carries the preset's rules, keyed on that root.
  const css = await (await app.client.anonymous().get('/_ket/asset/website_backend/public.css')).text()
  assert.match(css, /\[data-theme-preset="?cosmetics"?\]/)
  assert.match(css, /\[data-theme-preset="?cosmetics"?\]\[data-accent="?indigo"?\]/)

  // The page published before the choice takes the look at once and keeps its published words.
  const before = await visit('/trang-cu')
  assert.match(siteRoot(before), /data-theme-preset="cosmetics"/)
  assert.match(before, /Trang cũ/)
  assert.equal(
    ((await publisher('website.getEntry', { id: 'page-earlier' })).entry as Row).revisionId,
    earlier,
    'a style change publishes nothing',
  )
})
