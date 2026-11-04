import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { templateLayout } from '../packages/website-client/client/screens/template-layout.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

type Template = Row & { id: string; heading: string; body: string }

const studio = async (app: Awaited<ReturnType<typeof bootWebsiteStudio>>['app']) => {
  const client = app.client.anonymous()
  await client.login({ login: 'studio-publisher', password: 'studio-local' })
  return async (name: string, input: Row) => {
    const response = await client.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
    const body = (await response.json()) as { value: Row }
    assert.equal(response.status, 200, `${name}: ${JSON.stringify(body)}`)
    return body.value
  }
}

/**
 * A template replaces what a page says, never what it said: the page it lands on keeps its earlier
 * revisions, and the replacement is an ordinary draft that publishes and is served like any other.
 */
test('Studio templates: each one applied to a live page keeps its history and is what visitors get', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'tpl-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const call = await studio(app)
  const original = await call('website.saveEntry', {
    id: 'tpl-page',
    siteId: 'site-a',
    type: 'page',
    title: 'Giới thiệu',
    path: '/gioi-thieu',
    layout: [{ id: 'node-old', type: 'website.rich_text', settings: { body: 'Nội dung cũ của cửa hàng' } }],
    expectedRevisionId: null,
  })
  await call('website.publishEntry', {
    id: 'tpl-page',
    expectedRevisionId: original.revisionId,
    publishAt: null,
  })
  const visit = async () => (await app.client.anonymous().get('/gioi-thieu')).text()
  assert.match(await visit(), /Nội dung cũ của cửa hàng/)

  const templates = (await call('website_studio.listResources', { siteId: 'site-a', kind: 'templates' }))
    .rows as Template[]
  assert.deepEqual(
    templates.map((r) => r.id),
    ['website-introduction', 'website-service', 'website-cosmetics'],
  )
  let head = String(original.revisionId)
  for (const template of templates) {
    // What the Builder writes when a template replaces the page: its own expansion, nothing kept.
    const saved = await call('website.saveEntry', {
      id: 'tpl-page',
      siteId: 'site-a',
      type: 'page',
      title: 'Giới thiệu',
      path: '/gioi-thieu',
      layout: templateLayout(template),
      expectedRevisionId: head,
    })
    head = String(saved.revisionId)
    await call('website.publishEntry', { id: 'tpl-page', expectedRevisionId: head, publishAt: null })
    const html = await visit()
    assert.match(html, new RegExp(template.heading), template.id)
    assert.match(html, new RegExp(template.body), template.id)
    assert.doesNotMatch(html, /Nội dung cũ của cửa hàng/, `${template.id} replaces the content`)
  }

  // Every earlier version is still there, and the first one comes back as a draft over the last template.
  const history = await call('website_studio.entryHistory', { id: 'tpl-page', siteId: 'site-a' })
  const revisions = history.revisions as Row[]
  assert.equal(revisions.length, 1 + templates.length)
  await call('website_studio.restoreEntry', {
    id: 'tpl-page',
    siteId: 'site-a',
    revisionId: original.revisionId,
    expectedRevisionId: head,
  })
  const restored = (await call('website.getEntry', { id: 'tpl-page' })).entry as Row
  assert.match(JSON.stringify(restored.layout), /Nội dung cũ của cửa hàng/)
  assert.match(await visit(), new RegExp(templates.at(-1)!.heading), 'restoring is a draft until published')
})

/**
 * Templates are code, expanded when they are applied, so nothing stored has to migrate when one
 * changes. What can break is a template naming a section a deployment does not compose: publishing
 * would then refuse the page. Every deployment the Studio ships in draws every template.
 */
for (const deployment of [undefined, 'commerce'] as const)
  test(`Studio templates: every template expands only to sections ${deployment ?? 'ketsuite'} composes`, async (t) => {
    const { app } = await bootWebsiteStudio(undefined, deployment ? { deployment } : {})
    t.after(() => app.close())
    const call = await studio(app)
    const templates = (await call('website_studio.listResources', { siteId: 'site-a', kind: 'templates' }))
      .rows as Template[]
    const sections = Object.keys((await call('website.getEntry', { id: 'page-site-a' })).sections as Row)
    assert.ok(templates.length)
    for (const template of templates)
      for (const placement of templateLayout(template))
        assert.ok(sections.includes(placement.type), `${template.id} uses ${placement.type}`)
  })
