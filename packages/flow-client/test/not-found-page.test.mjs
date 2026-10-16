import test from 'node:test'
import assert from 'node:assert/strict'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { notFoundPage } from '../atlas/not-found-page.mjs'

test('an unknown Flow address explains itself in the reader’s language and leads back to work', (t) => {
  t.after(() => setFlowLocale('en'))
  const vi = notFoundPage({
    company: 'acme',
    lang: 'vi',
    head: '<link rel="stylesheet" href="/flow-ui/styles.css">',
  })
  assert.match(vi, /^<!doctype html><html lang="vi">/)
  assert.match(vi, /<title>Không tìm thấy trang · Flow<\/title>/)
  assert.match(vi, /<h1 data-flow="empty-title">Không tìm thấy trang<\/h1>/)
  assert.match(vi, /href="\/flow\/my-work\?company=acme&amp;lang=vi"[^>]*>\s*Về Việc của tôi/)
  assert.match(vi, /href="\/flow-ui\/styles.css"/, 'the page is drawn with the product styles')
  assert.doesNotMatch(vi, /flow\.notFound/, 'no message key reaches the reader')
  const fallback = notFoundPage({ company: null, lang: 'xx' })
  assert.match(fallback, /<html lang="en">/)
  assert.match(fallback, /href="\/flow\/my-work\?company=demo"[^>]*>\s*Go to My work/)
})
