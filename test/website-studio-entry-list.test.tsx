import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const boot = {
  actor: { id: 'u1', name: 'Admin', capabilities: ['website.content.write'] },
  site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'vi', locales: ['vi'] },
  sites: [],
  offer: null,
  home: '/',
} as unknown as Boot

const row = (i: number) => ({
  id: `p${i}`,
  type: 'page',
  title: `Trang ${i}`,
  path: `/trang-${i}`,
  locale: 'vi',
  state: 'draft',
  updatedAt: '2026-10-27T00:00:00.000Z',
})

const render = async (target: string, value: Record<string, unknown> | Error) => {
  const [path, search = ''] = target.split('?')
  const query = Object.fromEntries(new URLSearchParams(search))
  const calls: Record<string, unknown>[] = []
  const studio = createWebsiteStudio(
    { path, query, bootstrap: boot },
    {
      call: async (name: string, input?: unknown) => {
        if (name === 'website.listEntries') {
          calls.push(input as Record<string, unknown>)
          if (value instanceof Error) throw value
          return value as never
        }
        return { rows: [], total: 0 } as never
      },
    },
  )
  const frame = await studio.serverFrame()
  const ids = [
    'fallback.body',
    ...['list', 'record', 'workspace'].flatMap((k) => [`${k}-0.body`, `${k}-0.footer`]),
  ]
  const html = ids
    .map((id) => renderToString(studio.region({ id, initial: '' }) as never))
    .join('')
    .replace(/<!--k[^>]*-->/g, '')
  const page = renderToString(frame.view as never).replace(/<!--k[^>]*-->/g, '')
  return { html, page, calls }
}

test('page list: the address holds the filters and the page, and the pager keeps them', async () => {
  const { html, calls } = await render('pages?status=draft&q=trang&page=2', {
    rows: Array.from({ length: 30 }, (_, i) => row(31 + i)),
    total: 65,
    page: 2,
    pageSize: 30,
  })
  assert.deepEqual(calls[0], {
    siteId: 's1',
    type: 'page',
    status: 'draft',
    search: 'trang',
    locale: '',
    page: 2,
  })
  assert.match(html, /31–60 trên 65/)
  // The DS only styles a pager inside the list chrome; a bare one rendered as two loose glyphs.
  assert.match(html, /data-ui="list-chrome"[\s\S]*data-ui="pager-bar"/)
  const hrefs = [...html.matchAll(/href="([^"]*pages[^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'))
  assert.ok(
    hrefs.some((h) => /status=draft/.test(h) && /q=trang/.test(h) && /page=3/.test(h)),
    'next keeps the filters',
  )
  assert.ok(
    hrefs.some((h) => /status=draft/.test(h) && /q=trang/.test(h) && !/page=/.test(h)),
    'previous to the first page drops the page',
  )
})

test('page list: empty after a filter offers to clear it, an empty site offers to create', async () => {
  const filtered = await render('pages?q=khong-co', { rows: [], total: 0, page: 1, pageSize: 30 })
  assert.match(filtered.html, /Không có kết quả phù hợp/)
  assert.match(filtered.html, /Xoá bộ lọc/)
  assert.doesNotMatch(filtered.html, /Tạo trang/)
  const empty = await render('pages', { rows: [], total: 0, page: 1, pageSize: 30 })
  assert.doesNotMatch(empty.html, /Không có kết quả phù hợp/)
  assert.match(empty.html, /Tạo trang/)
})

test('page list: a failed read says so instead of showing an empty site', async () => {
  const { html, page } = await render('pages', Object.assign(new Error('down'), { code: 'unavailable' }))
  const shown = html + page
  assert.match(shown, /Chưa tải được/)
  assert.doesNotMatch(shown, /Chưa có trang nào|Không có kết quả phù hợp/)
})
