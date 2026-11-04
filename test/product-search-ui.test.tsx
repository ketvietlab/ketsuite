import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './fixtures/sale/commerce.ts'
import { searchQuery, searchHref } from '../packages/ketsuite/src/modules/product_backend/search/shared.ts'
import { searchHelp } from '../packages/ketsuite/src/modules/product_backend/search/help.tsx'
test('P57 canonical query preserves context but discards all list and modal state', () => {
  const query = searchQuery(
    new URL(
      'http://test/admin/product/templates?company=acme&branch=main&lang=en&q=%20Tea%20&page=2&pageSize=99&status=archived&category=private&tag=private&use=tracked&record=x&sort=name&dir=desc',
    ),
  )
  assert.deepEqual(query, {
    q: 'Tea',
    page: 2,
    pageSize: 25,
    href: '/admin/product/search?lang=en&company=acme&branch=main&q=Tea&page=2',
  })
  assert.equal(searchQuery(new URL('http://test/admin/product/search?page=Infinity')).page, 1)
  assert.equal(searchQuery(new URL('http://test/admin/product/search?page=2.5')).page, 1)
  assert.equal(
    searchHref(query.href, { q: '', page: null }),
    '/admin/product/search?lang=en&company=acme&branch=main',
  )
})
test('P57 hidden search uses native paged islands, scoped topbar, localized labels and Help', async (t) => {
  const r = await boot(t)
  for (const [lang, title] of [
    ['vi', 'Tìm trong Sản phẩm'],
    ['en', 'Search in Products'],
  ]) {
    const response = await r.app.client.get(`/admin/product/search?lang=${lang}&company=acme&q=Tea`)
    assert.equal(response.status, 200)
    const html = await response.text()
    for (const name of ['controls', 'results', 'footer'])
      assert.match(html, new RegExp(`product.search-${name}`))
    assert.match(html, /product_backend.searchCatalogue/)
    assert.match(html, new RegExp(title!))
    assert.match(html, /data-ui="global-search-trigger"/)
    assert.match(html, /data-ui="help-drawer"/)
    assert.doesNotMatch(html, /data-ui="global-search-dialog"/)
    assert.doesNotMatch(html, /product_backend\.search\.(title|search|empty|kind)/)
  }
  const product = await r.app.client.get(
    '/admin/product/templates?lang=en&company=acme&category=old&tag=old&use=tracked',
  )
  const html = await product.text()
  const trigger = html.match(/<a[^>]*data-ui="global-search-trigger"[^>]*>/)?.[0]
  assert.ok(trigger)
  assert.match(trigger, /href="\/admin\/product\/search\?company=acme&amp;lang=en&amp;q="/)
  assert.doesNotMatch(trigger, /category=|tag=|use=/)
  for (const lang of ['vi', 'en'] as const)
    assert.equal((searchHelp[lang].source.match(/^## /gm) ?? []).length, 3)
})
test('P57 product pages return to search and reject external return targets', async (t) => {
  const r = await boot(t)
  await r.save('product.saveRecord', {
    id: 'tea',
    name: 'Tea',
    type: 'goods',
    uomId: 'each',
    defaultCode: 'TEA',
  })
  const back = '/admin/product/search?company=acme&lang=en&q=Tea&page=2'
  const response = await r.app.client.get(
    '/admin/product/templates/tea?lang=en&returnTo=' + encodeURIComponent(back),
  )
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(html.includes(back.replaceAll('&', '&amp;')))
  const hostile = await r.app.client.get(
    '/admin/product/templates/tea?lang=en&returnTo=' + encodeURIComponent('https://outside.invalid/steal'),
  )
  assert.doesNotMatch(await hostile.text(), /href="https:\/\/outside.invalid/)
})
