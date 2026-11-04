import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createWebsiteStudio } from '../packages/website-client/client/studio.tsx'
import type { Boot } from '../packages/website-client/client/types.ts'

const bootFor = (locales: string[]) =>
  ({
    actor: { id: 'u1', name: 'Admin', capabilities: ['website.content.write'] },
    site: { id: 's1', name: 'Shop', host: 'shop.test', defaultLocale: 'vi', locales },
    sites: [],
    offer: null,
    home: '/',
  }) as unknown as Boot

const render = async (locales: string[], translations: unknown[]) => {
  const calls: string[] = []
  const studio = createWebsiteStudio(
    { path: 'entries/post-vi', bootstrap: bootFor(locales) },
    {
      call: async (name: string) => {
        calls.push(name)
        if (name === 'website_studio.entryHistory')
          return {
            entry: {
              id: 'post-vi',
              type: 'page',
              title: 'Trà xanh',
              path: '/tra-xanh',
              locale: 'vi',
              revisionId: 'r1',
              layout: [],
            },
            revisions: [],
          } as never
        if (name === 'website.listTranslations') return translations as never
        if (name === 'website.diffRevisions') return { changes: [] } as never
        return { rows: [], total: 0 } as never
      },
    },
  )
  await studio.serverFrame()
  const ids = ['fallback.body', ...['list', 'record', 'workspace'].map((kind) => `${kind}-0.body`)]
  return {
    html: ids.map((id) => renderToString(studio.region({ id, initial: '' }) as never)).join(''),
    calls,
  }
}

const vi = {
  id: 'post-vi',
  locale: 'vi',
  title: 'Trà xanh',
  path: '/tra-xanh',
  status: 'draft',
  published: false,
}
const en = {
  id: 'post-en',
  locale: 'en',
  title: 'Green tea',
  path: '/en/tra-xanh',
  status: 'published',
  published: true,
}

test('the entry page lists its translations and offers only the languages still missing', async () => {
  const { html, calls } = await render(['vi', 'en', 'ja'], [vi, en])
  assert.ok(calls.includes('website.listTranslations'))
  assert.match(html, /Bản dịch/)
  // The other language links to its own page; this one is not a link to itself.
  assert.match(html, /href="[^"]*entries\/post-en[?"][^>]*>(?:<!--[^>]*-->)*Green tea</)
  assert.doesNotMatch(html, /href="[^"]*entries\/post-vi[?"]/)
  assert.match(html, /Đã xuất bản/)
  // Only Japanese is left to translate into.
  const choices = /id="translation-locale"[\s\S]*?<\/select>/.exec(html)?.[0] ?? ''
  assert.match(choices, /value="ja"/)
  assert.doesNotMatch(choices, /value="(vi|en)"/)
  assert.match(html, /value="structure"/)
  assert.match(html, /Gỡ khỏi nhóm bản dịch/)
})

test('a site in one language explains where languages are added instead of offering a form', async () => {
  const { html } = await render(['vi'], [vi])
  assert.match(html, /Website mới có một ngôn ngữ/)
  assert.doesNotMatch(html, /id="translation-locale"/)
  assert.doesNotMatch(html, /Gỡ khỏi nhóm bản dịch/)
})

test('every language translated: nothing left to create', async () => {
  const { html } = await render(['vi', 'en'], [vi, en])
  assert.match(html, /Đã có bản dịch cho mọi ngôn ngữ/)
  assert.doesNotMatch(html, /Tạo bản dịch/)
})
