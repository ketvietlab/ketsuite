import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const render = async (capabilities: string[], state = 'published') => {
  const boot = {
    actor: { id: 'u1', name: 'Admin', capabilities },
    site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'vi', locales: ['vi'] },
    sites: [],
    offer: null,
    home: '/',
  } as unknown as Boot
  const studio = createWebsiteStudio(
    { path: 'entries/about', bootstrap: boot },
    {
      call: async (name: string) => {
        if (name === 'website_studio.entryHistory')
          return {
            entry: {
              id: 'about',
              siteId: 's1',
              type: 'page',
              title: 'Giới thiệu',
              path: '/gioi-thieu',
              locale: 'vi',
              revisionId: 'r1',
              layout: [],
              state,
            },
            revisions: [],
            usage: [
              { id: 'menu-about', title: 'Về chúng tôi', type: 'menu' },
              { id: 'home', title: 'Trang chủ', type: 'publication' },
            ],
          } as never
        if (name === 'website.diffRevisions') return { changes: [] } as never
        if (name === 'website.listTranslations') return [] as never
        return { rows: [], total: 0 } as never
      },
    },
  )
  await studio.serverFrame()
  const ids = [
    'fallback.body',
    ...['list', 'record', 'workspace'].flatMap((kind) => [`${kind}-0.body`, `${kind}-0.actions`]),
  ]
  return ids.map((id) => renderToString(studio.region({ id, initial: '' }) as never)).join('')
}

// The menu item that opens the archive confirmation: a disabled one renders without its button.
const archiveItem = (html: string) =>
  html.match(/id="entry-archive-more-panel".*?<\/div>/s)?.[0].replace(/<!--k[^>]*-->/g, '') ?? ''

test('history: archiving a live page is the publisher’s, with what links to it named', async () => {
  const editor = await render(['website.content.write'])
  assert.match(archiveItem(editor), /aria-disabled="true"/, 'an editor cannot take a live page off the site')
  const draft = await render(['website.content.write'], 'draft')
  assert.doesNotMatch(archiveItem(draft), /disabled/, 'a draft is the author’s to archive')
  const publisher = await render(['website.content.write', 'website.publish'])
  assert.match(archiveItem(publisher), /Lưu trữ/, 'the archive item is rendered')
  assert.doesNotMatch(archiveItem(publisher), /disabled/)
  assert.match(publisher, /Menu: Về chúng tôi, Trang chủ \(đã xuất bản\)/)
})

test('history: an author archiving a draft post is told what links to it too', async () => {
  const calls: string[] = []
  const studio = createWebsiteStudio(
    {
      path: 'posts/tin-moi',
      bootstrap: {
        actor: { id: 'u1', name: 'Admin', capabilities: ['website.content.write'] },
        site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'vi', locales: ['vi'] },
        sites: [],
        offer: null,
        home: '/',
      } as unknown as Boot,
    },
    {
      call: async (name: string) => {
        calls.push(name)
        if (name === 'website.getEntry')
          return {
            entry: {
              id: 'tin-moi',
              siteId: 's1',
              type: 'post',
              title: 'Tin mới',
              path: '/tin-tuc/tin-moi',
              locale: 'vi',
              revisionId: 'r1',
              layout: [],
              state: 'draft',
            },
          } as never
        if (name === 'website_studio.entryHistory')
          return { revisions: [], usage: [{ id: 'home', title: 'Trang chủ', type: 'draft' }] } as never
        return { rows: [], total: 0 } as never
      },
    },
  )
  await studio.serverFrame()
  const html = [
    'fallback.body',
    ...['list', 'record', 'workspace'].flatMap((kind) => [`${kind}-0.body`, `${kind}-0.actions`]),
  ]
    .map((id) => renderToString(studio.region({ id, initial: '' }) as never))
    .join('')
  assert.ok(
    calls.includes('website_studio.entryHistory'),
    'the draft’s author may archive it, so usage is read',
  )
  assert.match(html, /Trang chủ \(bản nháp\)/)
})
