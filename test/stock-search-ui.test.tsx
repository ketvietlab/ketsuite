import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'
import { searchQuery, searchHref } from '../packages/ketsuite/src/modules/stock_backend/search/shared.ts'

test('K55 the search address keeps the context and the keyword, nothing of a list', () => {
  const query = searchQuery(
    new URL(
      'http://test/admin/stock/transfers?company=acme&branch=main&lang=en&q=%20WH%2FXK%20&page=2&pageSize=99&preset=done&warehouse=hn&record=x',
    ),
  )
  assert.deepEqual(query, {
    q: 'WH/XK',
    page: 2,
    pageSize: 25,
    href: '/admin/stock/search?lang=en&company=acme&branch=main&q=WH%2FXK&page=2',
  })
  assert.equal(searchQuery(new URL('http://test/admin/stock/search?page=0')).page, 1)
  assert.equal(
    searchHref(query.href, { q: '', page: null }),
    '/admin/stock/search?lang=en&company=acme&branch=main',
  )
})

test('K55 Search in Stock renders its islands, every label translated, and its own guide', async (t) => {
  const r = await setup(t)
  for (const [lang, title, sample] of [
    ['vi', 'Tìm trong Kho', ['Phiên kiểm kê', 'Điều chỉnh kiểm kê', 'Sắp hết hạn', 'Đang đếm', 'Đang dùng']],
    ['en', 'Search in Stock', ['Stock count', 'Count adjustment', 'Expiring soon', 'Counting', 'Active']],
  ] as const) {
    const response = await r.app.client.request(`/admin/stock/search?lang=${lang}&q=goods`)
    assert.equal(response.status, 200)
    // Without the view's hydration markers, so text sits next to its tag.
    const html = (await response.text()).replace(/<!--k\[?-->/g, '')
    for (const name of ['controls', 'results', 'footer'])
      assert.match(html, new RegExp(`stock\\.search-${name}`))
    assert.match(html, /stock_backend\.searchStock/)
    assert.match(html, new RegExp(`<h1[^>]*>${title}<`))
    for (const label of sample) assert.ok(html.includes(label), `${lang}: ${label}`)
    // A label without its message would show its key.
    assert.doesNotMatch(html, /stock_backend\.(search|analysis\.kind|state|lot\.condition|count\.state)\.\w+/)
    // The topbar opens this page rather than a dialog; the guide is the page's own.
    assert.doesNotMatch(html, /data-ui="global-search-dialog"/)
    assert.match(html, /id="stock-search-help"/)
    assert.match(html, new RegExp(lang === 'vi' ? 'Tìm một bản ghi Kho' : 'Find a stock record'))
  }
})
