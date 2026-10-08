import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderSpecPage, scriptJson, type SpecAssets } from '../packages/ketspec/src/page.ts'

const assets: SpecAssets = {
  script: 'assets/ketspec.mjs',
  designSystemStyles: 'assets/design-system.css',
  styles: 'assets/ketspec.css',
  logo: 'assets/logo-light.svg',
  logoDark: 'assets/logo-dark.svg',
  favicon: 'assets/mark.svg',
}

const document = {
  openapi: '3.1.0',
  info: { title: 'Orders </script><script>alert(1)</script>', version: '2.0.0' },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  security: [{ bearer: [] }],
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', summary: 'List orders', responses: { 200: { description: 'OK' } } },
      post: {
        operationId: 'createOrder',
        summary: 'Create an order',
        'x-ket-idempotent': true,
        'x-ket-capability': { key: 'sales.orders', action: 'create' },
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } },
          },
        },
        responses: { 201: { description: 'Created' }, 422: { description: 'Invalid' } },
      },
    },
  },
}

test('ketspec page: a static page renders the overview with path-relative links and the Spec brand', () => {
  const html = renderSpecPage({ document, assets, locale: 'vi' })
  assert.match(html, /^<!doctype html>\n<html lang="vi">/)
  assert.match(html, /<title>Orders &lt;\/script&gt;.* · Spec<\/title>/)
  assert.match(
    html,
    /<div id="spec" data-kv-design-system data-presentation="grouped" data-density="compact" data-ketspec/,
  )
  assert.match(html, /<a data-ui="app-brand" href="\?" aria-label="Spec">/)
  assert.match(
    html,
    /<img src="assets\/logo-light.svg" alt="Spec" data-appearance="light"><img src="assets\/logo-dark.svg" alt="Spec" data-appearance="dark">/,
  )
  for (const [region] of [['topbar'], ['navigation'], ['main']])
    assert.match(html, new RegExp(`data-spec-region="${region}"`))
  assert.match(html, /href="\?operation=createOrder"/)
  assert.doesNotMatch(html, /href="\/\?/, 'a static page may be hosted under any path')
  assert.match(
    html,
    /<link rel="stylesheet" href="assets\/design-system.css">\n<link rel="stylesheet" href="assets\/ketspec.css">/,
  )
  assert.match(html, /<script type="module" src="assets\/ketspec.mjs"><\/script>/)
  // The embedded document cannot close its script element.
  const embedded = html.slice(html.indexOf('id="spec-document">'), html.lastIndexOf('<script type="module"'))
  assert.equal(embedded.match(/<\/script>/g)?.length, 1)
  assert.doesNotMatch(embedded, /<script>alert/)
})

test('ketspec page: an operation renders its request, responses and a console that sends nothing on the server', () => {
  const html = renderSpecPage({ document, assets, url: '/docs/api?operation=createOrder', locale: 'en' })
  assert.match(html, /<title>Create an order · Orders .* · Spec<\/title>/)
  assert.match(html, /href="\/docs\/api\?operation=listOrders"/)
  assert.match(html, /<form id="spec-try" data-spec-try="createOrder" method="get" action="#" novalidate/)
  // Exactly one submit command, so Enter sends the request and nothing else.
  const start = html.indexOf('<form id="spec-try"')
  const form = html.slice(start, html.indexOf('</form>', start))
  assert.equal(form.match(/type="submit"/g)?.length, 1)
  assert.match(form, /aria-live="polite"/)
  // A required Idempotency-Key is generated in the browser, so the server output is stable.
  assert.equal(
    renderSpecPage({ document, assets, url: '/docs/api?operation=createOrder' }),
    renderSpecPage({ document, assets, url: '/docs/api?operation=createOrder' }),
  )
  assert.match(html, /data-ui="tree-grid"|data-ui="schema"/)
  assert.match(html, /422/)
  // Credentials are entered once in the Sign in dialog; the console field only shows them.
  assert.match(
    html,
    /<button[^>]*id="spec-sign-in"[^>]*aria-controls="spec-sign-in-dialog"|<button[^>]*aria-controls="spec-sign-in-dialog"[^>]*id="spec-sign-in"/,
  )
  assert.match(html, /<div data-spec-region="dialog"><\/div>/)
  assert.match(form, /name="auth\.bearer"[^>]*readonly|readonly[^>]*name="auth\.bearer"/)
  assert.match(form, /id="spec-try-sign-in"/)
  // The capability is a Permission fact, not raw extension JSON.
  assert.match(html, />Permission</)
  assert.match(html, /sales\.orders<\/code> · create/)
  assert.doesNotMatch(html.slice(0, html.indexOf('id="spec-document"')), /x-ket-capability/)
})

test('ketspec page: alternative schemes read as "any one" on the overview and "or" on an operation', () => {
  const schemes = {
    staffBearer: { type: 'http', scheme: 'bearer' },
    staffCookie: { type: 'apiKey', in: 'cookie', name: 'ket_session' },
    staffGateway: { type: 'apiKey', in: 'header', name: 'x-ket-gateway-assertion' },
  }
  const alternatives = {
    openapi: '3.1.0',
    info: { title: 'Staff', version: '1' },
    components: { securitySchemes: schemes },
    paths: {
      '/me': {
        get: {
          operationId: 'me',
          security: [{ staffBearer: [] }, { staffCookie: [] }, { staffGateway: [] }],
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  }
  const strip = (html: string) => html.replace(/<!--k[^>]*-->/g, '')
  const overview = strip(renderSpecPage({ document: alternatives, assets, locale: 'en' }))
  assert.match(overview, />Any one of these is accepted\.</)
  const operation = strip(
    renderSpecPage({ document: alternatives, assets, url: '/?operation=me', locale: 'en' }),
  )
  assert.match(
    operation,
    /<code data-ui="code">staffBearer<\/code><span[^>]*>or<\/span><code data-ui="code">staffCookie<\/code><span[^>]*>or<\/span><code data-ui="code">staffGateway<\/code>/,
  )
  const both = {
    ...alternatives,
    paths: {
      '/me': { get: { operationId: 'me', security: [{ staffBearer: [], staffGateway: [] }], responses: {} } },
    },
  }
  assert.match(
    strip(renderSpecPage({ document: both, assets, locale: 'vi' })),
    />Mỗi operation ghi rõ cách nào nó chấp nhận\.</,
  )
  const combined = strip(renderSpecPage({ document: both, assets, url: '/?operation=me', locale: 'vi' }))
  assert.match(combined, /staffBearer<\/code><span[^>]*>và<\/span><code data-ui="code">staffGateway/)
  // A single scheme needs no note.
  assert.doesNotMatch(strip(renderSpecPage({ document, assets, locale: 'en' })), /Any one of these/)
})

test('ketspec page: without a document the page loads one, and an unknown operation is reported', () => {
  const loading = renderSpecPage({ specUrl: '/openapi.json?v=1&x=<y>', assets })
  assert.match(loading, /data-spec-url="\/openapi.json\?v=1&amp;x=&lt;y&gt;"/)
  assert.doesNotMatch(loading, /id="spec-document"/)
  assert.match(loading, /aria-busy="true"|data-ui="skeleton"/)
  const missing = renderSpecPage({ document, assets, url: '/?operation=nope' })
  assert.match(missing, /nope/)
  const invalid = renderSpecPage({ document: { swagger: '2.0' }, assets })
  assert.match(invalid, /data-ui="notice"/)
})

test('ketspec page: the theme can be forced, and JSON for a script element is escaped', () => {
  const dark = renderSpecPage({ document, assets, theme: 'dark' })
  assert.match(dark, /<meta name="color-scheme" content="dark">/)
  assert.match(dark, /data-ketspec data-theme="dark"/)
  assert.equal(scriptJson({ a: '</script>\u2028&' }), '{"a":"\\u003c/script\\u003e\\u2028\\u0026"}')
})

test('ketspec page: the package stylesheet only frames the document, with tokens', () => {
  const css = readFileSync('packages/ketspec/src/styles.css', 'utf8')
  assert.match(css, /@layer ket\.app/)
  assert.match(css, /background: var\(--kv-page-bg\)/)
  assert.match(css, /max-inline-size: var\(--kv-reading-width\)/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(|\d+px/i)
  for (const name of ['logo-light.svg', 'logo-dark.svg', 'mark.svg']) {
    const svg = readFileSync(`packages/ketspec/src/assets/${name}`, 'utf8')
    assert.match(svg, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    assert.doesNotMatch(
      svg,
      /<script|<text|href=/,
      `${name} is self-contained and draws its wordmark as paths`,
    )
  }
  assert.match(readFileSync('packages/ketspec/src/assets/logo-light.svg', 'utf8'), /width="136" height="36"/)
})
