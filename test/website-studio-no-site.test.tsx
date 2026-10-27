import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const boot = (capabilities: string[]): Boot =>
  ({
    actor: { id: 'u1', name: 'Admin', capabilities },
    site: null,
    sites: [],
    offer: null,
    home: '/',
  }) as unknown as Boot

async function render(path: string, capabilities: string[], rows: unknown[] = []) {
  const calls: string[] = []
  const studio = createWebsiteStudio(
    { path, bootstrap: boot(capabilities) },
    {
      call: async (name: string) => {
        calls.push(name)
        return { rows, total: rows.length } as never
      },
    },
  )
  await studio.serverFrame()
  // The SSR frame only carries loading regions; the page bodies are what the reader sees.
  const ids = ['fallback.body', ...['list', 'record', 'workspace'].map((kind) => `${kind}-0.body`)]
  const body = ids.map((id) => renderToString(studio.region({ id, initial: '' }) as never)).join('')
  return { html: body.replace(/<!--[\s\S]*?-->/gu, ''), calls }
}

test('a site screen of a company without a website offers its first site instead of failing', async () => {
  const { html, calls } = await render('overview', ['website.site.manage'])
  assert.deepEqual(calls, [], 'no site-scoped read runs without a site')
  assert.match(html, /Công ty chưa có website/)
  assert.match(html, /href="\/website\/sites\/new"/)
  assert.doesNotMatch(html, /Cannot read properties|Chưa tải được website|Thử lại/)
})

test('a viewer who cannot manage sites is told who can create one', async () => {
  const { html } = await render('pages', [])
  assert.match(html, /Công ty chưa có website/)
  assert.match(html, /Nhờ người quản trị website/)
  assert.doesNotMatch(html, /href="\/website\/sites\/new"/)
})

test('company screens still read without a selected website', async () => {
  const { calls, html } = await render('sites', ['website.site.manage'])
  assert.ok(calls.length > 0)
  assert.doesNotMatch(html, /Công ty chưa có website/)
})

test('the site list names each site by host and state, never by company id', async () => {
  const { html } = await render(
    'sites',
    ['website.site.manage'],
    [
      {
        id: 's1',
        title: 'Cửa hàng',
        host: 'shop.test',
        state: 'paused',
        companyId: 'c-0001',
        defaultLocale: 'vi',
      },
    ],
  )
  assert.match(html, /shop\.test/)
  assert.match(html, /Tạm dừng/)
  assert.doesNotMatch(html, /c-0001/)
})

test('a new site asks only for what the host stores', async () => {
  const { html } = await render('sites/new', ['website.site.manage'])
  for (const name of ['title', 'host', 'code', 'defaultLocale'])
    assert.match(html, new RegExp(`name="${name}"`))
  for (const name of [
    'companyId',
    'timezone',
    'state',
    'realm',
    'retentionDays',
    'consentVersion',
    'authReady',
  ])
    assert.doesNotMatch(html, new RegExp(`name="${name}"`))
})
