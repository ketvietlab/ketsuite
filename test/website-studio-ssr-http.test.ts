import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootStudioHardening } from './fixtures/website-studio-hardening.ts'

// This inspects trusted server output, not arbitrary HTML from users.
const staticIdentity = (markup: string) => {
  const stack: { name: string; island: boolean }[] = []
  let titles = 0
  let islands = 0
  for (const match of markup.matchAll(/<!--[\s\S]*?-->|<(?:(?:"[^"]*"|'[^']*')|[^'">])*?>/g)) {
    const tag = match[0]
    if (tag.startsWith('<!--') || tag.startsWith('<!')) continue
    const name = /^<\/?([\w-]+)/.exec(tag)?.[1]?.toLowerCase()
    if (!name) continue
    if (tag.startsWith('</')) {
      const at = stack.map((node) => node.name).lastIndexOf(name)
      if (at >= 0) stack.splice(at)
      continue
    }
    const island = /\bdata-island=/.test(tag)
    const inside = stack.some((node) => node.island)
    if (island) {
      islands++
      assert.match(tag, /data-island="website.region"/)
    }
    if (/data-kv-page-identity="title"/.test(tag)) {
      titles++
      assert.equal(inside, false, 'page title is server-owned')
    }
    if (/data-ui="app-(shell|navigation|topbar|switcher)"/.test(tag))
      assert.equal(inside, false, 'shell chrome is server-owned')
    if (
      !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name) &&
      !tag.endsWith('/>')
    )
      stack.push({ name, island })
  }
  assert.ok(titles > 0, 'native identity is in the initial document')
  assert.ok(islands > 0, 'data slots have independent hydration boundaries')
}

test('commerce serves every native Studio route with SSR identity and independent data regions', async (t) => {
  const { app, client, paths } = await bootStudioHardening()
  t.after(() => app.close())
  const fallback: string[] = []
  const starter = await client.post(
    '/website/api/website_studio.getResource',
    JSON.stringify({ siteId: 'site-a', kind: 'templates', id: 'website-introduction' }),
    { headers: { 'content-type': 'application/json' } },
  )
  assert.equal(starter.status, 200)
  assert.equal(((await starter.json()) as { value: { readOnly: boolean } }).value.readOnly, true)
  const alias = paths.find((path) => path.key === 'catalog-template')!
  const redirected = await client.get(alias.url, { redirect: 'manual' })
  assert.equal(redirected.status, 303)
  assert.match(redirected.headers.get('location')!, /^\/website\/pages\/catalog-template--/)
  for (const { key, url } of paths) {
    const response = await client.get(url)
    assert.equal(response.status, 200, key)
    assert.equal(response.headers.get('cache-control'), 'no-store', key)
    const markup = await response.text()
    assert.match(markup, /data-website-rendering="ssr-regions"/, key)
    assert.match(markup, /data-ui="help-drawer"/, key)
    if (markup.includes('data-ui="app-shell"')) {
      assert.match(markup, /data-ui="app-switcher"/, key)
      assert.match(markup, /aria-label="Ứng dụng"/, key)
      assert.match(markup, /aria-label="Tìm kiếm menu"/, key)
    }
    staticIdentity(markup)
    if (markup.includes('data-website-frame-fallback="yes"')) fallback.push(key)
  }
  assert.deepEqual(fallback, [], 'seeded supported records must render their own native presenter')
})

test('native SSR retains login, company/site isolation and denied-record recovery without exposing data', async (t) => {
  const { app, client } = await bootStudioHardening()
  t.after(() => app.close())
  const anonymous = await app.client.anonymous().get('/website/overview?site=site-a', { redirect: 'manual' })
  // The deployment authentication gate owns anonymous requests before the Studio route.
  assert.equal(anonymous.status, 401)
  const blocked = app.client.anonymous()
  await blocked.login({ login: 'studio-blocked', password: 'studio-local' })
  assert.equal((await blocked.get('/website/overview?site=site-a')).status, 403)
  const foreign = await client.get('/website/pages/page-site-b/builder?site=site-b')
  assert.equal(foreign.status, 200)
  const markup = await foreign.text()
  assert.match(markup, /data-website-frame-fallback="yes"/)
  assert.doesNotMatch(markup, /Trang site-b|"id":"site-b"/)
  staticIdentity(markup)
})
