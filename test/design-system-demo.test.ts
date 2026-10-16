import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import test from 'node:test'
import { createDemo2Routes, createDemoRoutes } from '../apps/design-system/demo.tsx'

const request = (values: Record<string, string>, origin = 'http://127.0.0.1:4000') =>
  Object.assign(Readable.from([new URLSearchParams(values).toString()]), {
    method: 'POST',
    headers: { origin },
  }) as IncomingMessage
const url = new URL('http://127.0.0.1:4000/demo/action')
const valid = {
  intent: 'create',
  return: '/demo',
  customer: 'New customer',
  address: '12 Example Street',
  product: 'CF-01',
  quantity: '3',
  date: '2026-09-09',
  email: 'demo@example.com',
}

test('sales demo: public page compositions use one canonical pattern', () => {
  const routes = createDemoRoutes()
  for (const view of ['overview', 'orders', 'record', 'board']) {
    const response = routes['/demo'](new URL(`http://localhost/demo?view=${view}`))
    assert.equal(response.status, 200)
    assert.match(String(response.body), /data-presentation="grouped"/)
    assert.equal(
      [...String(response.body).matchAll(/data-pattern="(list|record|form|workspace|dashboard|board)"/g)]
        .length,
      1,
    )
    assert.match(String(response.body), /type="module" src="\/demo\/client.js"/)
    assert.match(String(response.body), /data-ui="app-navigation"/)
    assert.match(String(response.body), /data-ui="navigation-drawer"/)
    assert.match(String(response.body), /data-ui="navigation-item"/)
    assert.doesNotMatch(String(response.body), /class="demo-sidebar"/)
    assert.doesNotMatch(String(response.body), /catalogue-specimen/)
  }
})

test('submenu demo: every page uses the current location shell and keeps its tools out of the sidebar', () => {
  const routes = createDemo2Routes()
  for (const view of ['overview', 'orders', 'record', 'board']) {
    for (const theme of ['light', 'dark']) {
      const html = String(
        routes['/demo2'](new URL(`http://localhost/demo2?view=${view}&theme=${theme}`)).body,
      )
      assert.match(html, /data-ui="app-shell"[^>]*data-has-location="true"/)
      assert.doesNotMatch(html, /data-ui="app-shell-topbar"|data-ui="breadcrumbs"|demo-navigation-footer/)
      assert.match(html, /data-ui="app-navigation"[^>]*data-external-trigger="true"/)
      assert.match(html, /data-ui="app-brand" data-variant="mark"[\s\S]*src="\/demo2\/brand\/logo-dark.png"/)
      const main = html.slice(html.indexOf('<main data-ui="app-main"'))
      assert.match(main, /data-ket-slot="backend.global-topbar"[\s\S]*data-ui="app-location-bar"/)
      assert.match(main, /data-ui="navigation-toggle"[^>]*aria-controls="enterprise-navigation-drawer"/)
      assert.match(main, /data-ui="global-search-trigger"[^>]*aria-controls="demo2-global-search"/)
      assert.match(main, new RegExp(`action="/demo2/search/${theme}"`))
      assert.match(main, /data-ui="app-location-context"[\s\S]*An Việt Trading/)
      assert.match(main, /aria-label="Tài khoản Ngọc Linh"[\s\S]*id="demo2-account-panel"/)
      assert.match(main, /data-ui="global-search-dialog"/)
      assert.equal([...html.matchAll(/data-pattern="(list|record|workspace)"/g)].length, 1)
    }
  }
  const original = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo')).body)
  assert.doesNotMatch(original, /data-has-location="true"|data-ui="global-search-trigger"/)
  assert.match(original, /demo-navigation-footer/)
})

test('submenu demo: native global search preserves appearance and finds destinations and records', () => {
  const routes = createDemo2Routes()
  const endpoint = routes['/demo2/search/dark']
  assert.equal(typeof endpoint, 'function')
  const response = endpoint(new URL('http://localhost/demo2/search/dark?q=SO-1042&lang=vi'))
  assert.equal(response.status, 303)
  const location = new URL(response.headers!.location, 'http://localhost')
  assert.equal(location.searchParams.get('theme'), 'dark')
  assert.equal(location.searchParams.get('search'), 'global')
  assert.equal(location.searchParams.get('q'), 'SO-1042')
  const record = String(routes['/demo2'](location).body)
  assert.match(record, /Kết quả tìm kiếm/)
  assert.match(record, /href="\/demo2\?theme=dark&amp;view=record&amp;id=SO-1042"/)
  assert.match(record, /data-ui="global-search-input"[^>]*value="SO-1042"/)
  assert.doesNotMatch(record, /data-ui="navigation-item" data-active="true"/)

  const navigation = String(
    routes['/demo2'](new URL('http://localhost/demo2?search=global&q=ton%20kho')).body,
  )
  assert.match(navigation, /data-ui="nav-item"[^>]*href="\/demo2\?theme=light&amp;module=inventory/)
  const empty = String(routes['/demo2'](new URL('http://localhost/demo2?search=global')).body)
  assert.match(empty, /Bạn muốn tìm gì/)
  assert.doesNotMatch(empty, /data-ui="table"/)
  const missing = String(
    routes['/demo2'](new URL('http://localhost/demo2?search=global&q=zzzz-not-found')).body,
  )
  assert.match(missing, /Không tìm thấy kết quả/)
  const unsafe = String(routes['/demo2'](new URL('http://localhost/demo2?search=global&q=%3Cscript%3E')).body)
  assert.match(unsafe, /&lt;script&gt;/)
  const capped = endpoint(new URL(`http://localhost/demo2/search/dark?q=${'x'.repeat(250)}`))
  assert.equal(new URL(capped.headers!.location, 'http://localhost').searchParams.get('q')!.length, 200)
})

test('submenu demo: keeps the original demo intact and exposes 18 dense application modules', () => {
  const original = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo')).body)
  assert.doesNotMatch(original, /data-ui="navigation-branch"/)

  const html = String(createDemo2Routes()['/demo2'](new URL('http://localhost/demo2')).body)
  assert.equal([...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="1"/g)].length, 18)
  assert.equal([...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="2"/g)].length, 18)
  assert.equal([...html.matchAll(/data-ui="navigation-item"/g)].length, 126)
  assert.equal([...html.matchAll(/data-ui="navigation-group"/g)].length, 4)
  assert.equal(
    [...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="1"[^>]*open="true"/g)].length,
    1,
  )
  assert.doesNotMatch(html, /data-ui="navigation-branch"[^>]*data-active=/)
  assert.doesNotMatch(html, /data-ui="navigation-branch-indicator"/)
  assert.match(html, /data-ui="navigation-item-label"[^>]*>[^<]*<!--k\[-->Hôm nay/)
  assert.match(html, /data-ui="app-location-bar"/)
  assert.doesNotMatch(html, /data-ui="breadcrumbs"|data-ui="dashboard-page-context"/)
  assert.match(html, /data-ui="navigation-item" data-active="true"[^>]*aria-current="page"[\s\S]*?Hôm nay/)
  assert.match(html, /href="\/demo2\?theme=light&amp;module=crm&amp;section=0"/)
  assert.match(html, /href="\/demo2\?theme=light&amp;view=orders"/)
  assert.doesNotMatch(html, /(?:href|action)="\/demo(?:[?/]|&quot;)/)
})

test('submenu demo: every sidebar module owns four links and one nested branch with three destinations', () => {
  const modules = [
    'overview',
    'crm',
    'sales',
    'purchase',
    'products',
    'inventory',
    'warehouse',
    'delivery',
    'projects',
    'support',
    'accounting',
    'cashflow',
    'expenses',
    'billing',
    'reports',
    'people',
    'marketing',
    'settings',
  ]
  const route = createDemo2Routes()['/demo2']
  for (const module of modules) {
    const query =
      module === 'overview'
        ? ''
        : module === 'sales'
          ? '?view=orders'
          : module === 'delivery'
            ? '?view=board'
            : `?module=${module}`
    const html = String(route(new URL(`http://localhost/demo2${query}`)).body)
    assert.equal([...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="1"/g)].length, 18, module)
    assert.equal([...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="2"/g)].length, 18, module)
    assert.equal(
      [...html.matchAll(/data-ui="navigation-branch"[^>]*data-level="1"[^>]*open="true"/g)].length,
      1,
      module,
    )
    assert.equal([...html.matchAll(/data-ui="navigation-item"[^>]*data-active="true"/g)].length, 1, module)
  }
})

test('submenu demo: nested selection is URL-owned and the board submenu filters its columns', () => {
  const routes = createDemo2Routes()
  const nested = String(routes['/demo2'](new URL('http://localhost/demo2?module=inventory&child=1')).body)
  assert.match(nested, /data-ui="navigation-branch" data-level="1"[^>]*open="true"/)
  assert.match(nested, /data-ui="navigation-branch" data-level="2"[^>]*open="true"/)
  assert.match(nested, /data-ui="navigation-item" data-active="true" data-level="3"[^>]*aria-current="page"/)
  assert.doesNotMatch(nested, /data-ui="breadcrumbs"/)
  assert.match(nested, /data-ui="app-location-context"[\s\S]*An Việt Trading/)
  assert.match(
    nested,
    /data-ui="navigation-item" data-active="true"[^>]*aria-current="page"[\s\S]*?Luân chuyển hàng/,
  )
  assert.match(nested, /Luân chuyển hàng: 5 mục cần chú ý/)

  const board = String(routes['/demo2'](new URL('http://localhost/demo2?view=board&status=shipping')).body)
  assert.match(board, /data-demo-board="true" data-filtered="true"/)
  assert.match(
    board,
    /data-ui="navigation-item" data-active="true" data-level="2"[^>]*href="[^"]*status=shipping/,
  )
  assert.equal([...board.matchAll(/data-ui="section-title"/g)].length, 1)
})

test('sales demo: mobile page actions share the available width evenly', () => {
  const styles = String(createDemoRoutes()['/demo/styles.css']().body)
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\[data-ui="action"\] \{\s*width: 100%/)
})

test('sales demo: overview columns use the same grouped surface hierarchy', () => {
  const html = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo?theme=light')).body).replace(
    /<!--k\[?-->/gu,
    '',
  )
  assert.match(html, /data-ui="surface"[\s\S]*data-ui="surface-title"[\s\S]*?Ưu tiên hôm nay/)
  assert.doesNotMatch(html, /data-ui="section-title">Ưu tiên hôm nay/)
})

test('sales demo: collection paging belongs to ListChrome above the table', () => {
  const routes = createDemoRoutes()
  for (const query of ['', '&page=2', '&q=missing']) {
    const html = String(routes['/demo'](new URL(`http://localhost/demo?view=orders${query}`)).body)
    assert.doesNotMatch(html, /data-ui="list-page-footer"|data-ui="pager-pages"/)
    assert.match(html, /data-ui="list-chrome"[\s\S]*data-ui="pager-bar"[\s\S]*data-ui="list-page-body"/)
    assert.match(
      html,
      query === '' ? /1–8 \/ 12 đơn hàng/ : query === '&page=2' ? /9–12 \/ 12 đơn hàng/ : /0–0 \/ 0 đơn hàng/,
    )
  }
})

test('sales demo: search and status filters keep the current sort', () => {
  const html = String(
    createDemoRoutes()['/demo'](new URL('http://localhost/demo?view=orders&q=SO&sort=asc')).body,
  )
  assert.match(html, /data-ui="list-search"[\s\S]*name="sort" value="asc"/)
  assert.match(html, /data-ui="list-facet"[^>]*href="[^"]*q=SO[^"]*sort=asc/)
  assert.match(html, /data-ui="list-facet"[^>]*href="[^"]*sort=asc[^"]*status=draft/)
})

test('sales demo: validates and persists a created record without touching other instances', async () => {
  const routes = createDemoRoutes()
  const invalid = await routes['/demo/action'](url, request({ ...valid, quantity: '0' }))
  assert.equal(invalid.status, 422)
  assert.match(String(invalid.body), /aria-invalid="true"/)
  assert.match(String(invalid.body), /value="New customer"/)
  const created = await routes['/demo/action'](url, request(valid))
  assert.equal(created.status, 303)
  assert.match(created.headers!.location, /id=SO-1043/)
  const exported = routes['/demo/export'](new URL('http://localhost/demo/export?id=SO-1043'))
  assert.match(String(exported.body), /New customer/)
  assert.match(String(exported.body), /960000/)
  assert.doesNotMatch(
    String(createDemoRoutes()['/demo/export'](new URL('http://localhost/demo/export')).body),
    /New customer/,
  )
})

test('sales demo: rejects cross-origin writes and off-site redirects', async () => {
  const routes = createDemoRoutes()
  assert.equal((await routes['/demo/action'](url, request(valid, 'https://example.com'))).status, 403)
  assert.equal(
    (await routes['/demo/action'](url, request({ ...valid, return: '//example.com' }))).status,
    400,
  )
  assert.equal(
    (await routes['/demo/action'](url, request({ ...valid, intent: 'save', id: 'missing' }))).status,
    404,
  )
})

test('sales demo: create and selection commands stay in the header above filters', () => {
  const html = String(createDemoRoutes()['/demo'](new URL('http://localhost/demo?view=orders')).body)
  const header = html.indexOf('data-ui="list-page-header"')
  const create = html.indexOf('Tạo đơn hàng', header)
  const bulk = html.indexOf('data-ui="bulk-actions"', header)
  const filters = html.indexOf('data-ui="list-page-toolbar"', header)
  const body = html.indexOf('data-ui="list-page-body"', filters)
  assert.ok(header >= 0 && create > header && create < filters)
  assert.ok(bulk > header && bulk < filters && filters < body)
  assert.doesNotMatch(html, /data-ui="bulk-actions"[^>]*data-has-selection="true"/)
  assert.match(html, /form="bulk-form"/)
})

test('submenu navigation: SSR shell once, return only content and state for progressive navigation', () => {
  const routes = createDemo2Routes()
  const normal = routes['/demo2'](new URL('http://localhost/demo2'))
  assert.match(String(normal.body), /^<!doctype html>/)
  assert.match(String(normal.body), /data-ui="app-shell"/)
  assert.equal(normal.headers?.vary, 'X-Ket-Navigation')
  for (const query of [
    'view=orders',
    'module=crm',
    'view=board',
    'view=record',
    'modal=create',
    'search=global&q=ton+kho',
  ]) {
    const response = routes['/demo2'](new URL(`http://localhost/demo2?${query}`), {
      headers: { 'x-ket-navigation': 'fragment-v1' },
    })
    const body = String(response.body)
    assert.equal(response.type, 'text/vnd.ket.fragments+html')
    assert.match(body, /^<ket-fragments/)
    assert.match(body, /data-ket-slot="demo.content"/)
    assert.match(body, /data-ket-slot="demo.overlay"/)
    assert.match(body, /data-demo-navigation-state/)
    assert.doesNotMatch(
      body,
      /<!doctype|<head[ >]|<script[ >]|data-ui="app-shell"|data-ui="app-navigation"|backend.global-topbar|data-ui="app-location-bar"/,
    )
  }
})
