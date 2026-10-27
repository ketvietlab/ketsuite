import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const boot = {
  actor: { id: 'u1', name: 'Admin', capabilities: ['website.content.write'] },
  site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'en', locales: ['en'] },
  sites: [],
  offer: null,
  home: '/',
} as unknown as Boot

test('the menu editor offers only the header menu the site serves', async () => {
  const studio = createWebsiteStudio(
    { path: 'menus/s1', bootstrap: boot },
    {
      call: async (name: string) => {
        if (name === 'website_studio.getResource')
          return { id: 's1', kind: 'menus', title: 'Menu chính', revisionId: 'r1', items: [] } as never
        return { rows: [], total: 0 } as never
      },
    },
  )
  await studio.serverFrame()
  const ids = ['fallback.body', ...['list', 'record', 'workspace'].map((kind) => `${kind}-0.body`)]
  const html = ids.map((id) => renderToString(studio.region({ id, initial: '' }) as never)).join('')
  assert.match(html, /id="menu-title"/)
  // The API keeps one header menu in the default language; a footer or other language would be refused.
  assert.doesNotMatch(html, /id="menu-position"|id="menu-locale"|Chân trang/)
})
