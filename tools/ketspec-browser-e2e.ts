// Spec in a real browser: the static page, its runtime and the try-it console
// against a local mock API, at the supported widths in both themes.
//
// Run after a build: `npm run test:ketspec:browser`. Evidence (screenshots and
// measurements) is written to KETSPEC_EVIDENCE or a temporary directory, whose
// path is printed at the end.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { renderSpecPage, type SpecAssets } from '../packages/ketspec/src/page.ts'

type Json = Record<string, unknown>

const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })

class Cdp {
  private id = 0
  private readonly pending = new Map<
    number,
    { resolve: (value: Json) => void; reject: (error: Error) => void }
  >()
  readonly events: Json[] = []

  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json
      if (message.method) {
        this.events.push(message)
        return
      }
      const held = this.pending.get(Number(message.id))
      if (!held) return
      this.pending.delete(Number(message.id))
      if (message.error) held.reject(new Error(JSON.stringify(message.error)))
      else held.resolve((message.result as Json | undefined) ?? {})
    })
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true })
    })
    return new Cdp(socket)
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void {
    this.socket.close()
  }
}

const waitFor = async (check: () => Promise<boolean>, message: string, attempts = 200): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check().catch(() => false)) return
    await delay(50)
  }
  throw new Error(message)
}

// ---------------------------------------------------------------------------
// Fixtures

const ROOT = process.cwd()
const fixture = {
  openapi: '3.1.0',
  info: {
    title: 'Orders API',
    version: '2.4.0',
    description: 'Orders, returns and the reports that summarise them.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'A staff access token.' } },
    schemas: {
      Order: {
        type: 'object',
        required: ['note'],
        properties: {
          id: { type: 'string', format: 'uuid', readOnly: true },
          note: { type: 'string', minLength: 1, example: 'Leave at the door' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
        },
      },
      Line: {
        type: 'object',
        properties: { sku: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/orders': {
      get: {
        operationId: 'listOrders',
        summary: 'List orders',
        security: [{}],
        'x-ket-capability': 'sales.order.read',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }],
        responses: {
          200: {
            description: 'The orders',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createOrder',
        summary: 'Create an order',
        'x-ket-idempotent': true,
        'x-ket-capability': 'sales.order.create',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
        },
        responses: {
          201: {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          422: {
            description: 'Invalid input',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/reports/slow': {
      get: {
        operationId: 'slowReport',
        summary: 'Build a slow report',
        security: [{}],
        responses: { 200: { description: 'OK' } },
      },
    },
  },
}

/** Ten thousand operations over a hundred groups: the navigation and search must stay usable. */
const large = {
  openapi: '3.0.3',
  info: { title: 'Large API', version: '1.0.0' },
  paths: Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => [
      `/area${index % 100}/item${index}`,
      {
        get: {
          operationId: `op-${index * 2}`,
          summary: `Read item ${index}`,
          responses: { 200: { description: 'OK' } },
        },
        put: {
          operationId: `op-${index * 2 + 1}`,
          summary: `Replace item ${index}`,
          responses: { 200: { description: 'OK' } },
        },
      },
    ]),
  ),
}

const staff = JSON.parse(readFileSync(join(ROOT, 'docs/public/api/staff-v1.openapi.json'), 'utf8'))

const assets: SpecAssets = {
  script: '/assets/ketspec.mjs',
  designSystemStyles: '/assets/design-system.css',
  styles: '/assets/ketspec.css',
  logo: '/assets/logo-light.svg',
  logoDark: '/assets/logo-dark.svg',
  favicon: '/assets/mark.svg',
}
const files: Record<string, [string, string]> = {
  '/assets/ketspec.mjs': ['packages/ketspec/src/browser/ketspec.mjs', 'text/javascript'],
  '/assets/design-system.css': ['packages/design-system/dist/styles.css', 'text/css'],
  '/assets/ketspec.css': ['packages/ketspec/src/styles.css', 'text/css'],
  '/assets/logo-light.svg': ['packages/ketspec/src/assets/logo-light.svg', 'image/svg+xml'],
  '/assets/logo-dark.svg': ['packages/ketspec/src/assets/logo-dark.svg', 'image/svg+xml'],
  '/assets/mark.svg': ['packages/ketspec/src/assets/mark.svg', 'image/svg+xml'],
}

let flaky = 0
const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = ''
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    request.on('end', () => resolve(text))
  })

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

const pages: Record<string, unknown> = { '/spec': fixture, '/staff': staff, '/large': large }
const received: { method: string; headers: Record<string, string | string[] | undefined>; body: string }[] =
  []

const app = createHttpServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const file = files[url.pathname]
  if (file) {
    response.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' })
    response.end(readFileSync(join(ROOT, file[0])))
    return
  }
  const document = pages[url.pathname]
  if (document !== undefined) {
    const theme = url.searchParams.get('theme')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      renderSpecPage({
        document,
        url: `${url.pathname}${url.search}`,
        locale: url.searchParams.get('lang') ?? 'en',
        theme: theme === 'dark' || theme === 'light' ? theme : undefined,
        timeoutSeconds: 2,
        assets,
      }),
    )
    return
  }
  if (url.pathname === '/remote') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      renderSpecPage({ specUrl: '/fixtures/flaky.json', url: `${url.pathname}${url.search}`, assets }),
    )
    return
  }
  if (url.pathname === '/fixtures/flaky.json') {
    flaky += 1
    if (flaky === 1) json(response, 503, { error: { code: 'unavailable', message: 'Try later' } })
    else json(response, 200, fixture)
    return
  }
  if (url.pathname === '/api/orders') {
    const body = await readBody(request)
    received.push({ method: request.method ?? '', headers: request.headers, body })
    if (request.method === 'GET') return json(response, 200, [{ id: 'o-1', note: 'First' }])
    const parsed = body ? (JSON.parse(body) as { note?: string }) : {}
    if (!parsed.note)
      return json(
        response,
        422,
        {
          error: {
            code: 'invalid_input',
            message: 'Some fields need attention.',
            requestId: 'req-e2e-422',
            fields: {
              note: [{ field: 'note', code: 'required', messageKey: 'errors.required', params: {} }],
            },
          },
        },
        { 'x-request-id': 'req-e2e-422' },
      )
    return json(response, 201, { id: 'o-2', note: parsed.note }, { 'x-request-id': 'req-e2e-201' })
  }
  if (url.pathname === '/api/reports/slow') {
    await delay(4000)
    if (!response.destroyed) json(response, 200, { ok: true })
    return
  }
  response.writeHead(404)
  response.end()
})

// ---------------------------------------------------------------------------
// Browser

const appPort = await freePort()
const closedPort = await freePort()
const debugPort = await freePort()
await new Promise<void>((resolve) => app.listen(appPort, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${appPort}`
const chromeProfile = mkdtempSync(join(tmpdir(), 'ketspec-browser-'))
const evidence = process.env.KETSPEC_EVIDENCE ?? mkdtempSync(join(tmpdir(), 'ketspec-evidence-'))
mkdirSync(evidence, { recursive: true })
const chromePath =
  process.env.KET_BROWSER_BIN ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
const browser = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-gpu',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let diagnostics = ''
browser.stderr.on('data', (chunk: Buffer) => {
  diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-16_384)
})

let cdp: Cdp | null = null
const results: Json[] = []
const check = (name: string, detail: Json = {}) => {
  results.push({ check: name, ...detail })
  console.log(`  ✓ ${name}`)
}

try {
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok,
    `Chrome failed to start: ${diagnostics}`,
  )
  const target = (await (
    await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
  ).json()) as Json
  const page = await Cdp.connect(String(target.webSocketDebuggerUrl))
  cdp = page
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Network.enable')

  const evaluate = async <Value>(expression: string): Promise<Value> => {
    const response = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return ((response.result as Json | undefined)?.value ?? null) as Value
  }
  const until = (expression: string, message: string, attempts?: number) =>
    waitFor(() => evaluate<boolean>(expression), message, attempts)
  const viewport = (width: number, height = 900) =>
    page.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    })
  const open = async (path: string, state = 'ready') => {
    await page.send('Page.navigate', { url: `${origin}${path}` })
    await until(
      `document.readyState === 'complete' && document.querySelector('#spec')?.dataset.specState === ${JSON.stringify(state)}`,
      `${path} did not reach ${state}`,
    )
  }
  const key = async (key: string, code: string, keyCode: number, modifiers = 0) => {
    // Enter needs its text to activate links and submit forms the way a real key press does.
    const text = key === 'Enter' ? '\r' : undefined
    await page.send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
      ...(text ? { text } : {}),
    })
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
    })
  }
  const type = async (text: string) => {
    await page.send('Input.insertText', { text })
  }
  /** Sets a try-it field the way typing would, so the runtime's input listener sees it. */
  const fill = (name: string, value: string) =>
    evaluate<boolean>(`(() => {
      const control = document.querySelector('#spec-try').elements.namedItem(${JSON.stringify(name)})
      if (!control) return false
      control.value = ${JSON.stringify(value)}
      control.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
  const send = () => evaluate<void>(`document.querySelector('#spec-try').requestSubmit()`)
  /** Enters a bearer token through the Sign in dialog, typing it as a reader would. */
  const signIn = async (token: string, opener = '#spec-sign-in') => {
    await evaluate(
      `document.querySelector(${JSON.stringify(opener)}).focus(); document.querySelector(${JSON.stringify(opener)}).click()`,
    )
    await until(
      `document.activeElement?.closest('#spec-sign-in-dialog') && document.activeElement.matches('input[name="auth.bearer"]')`,
      'the sign-in dialog did not open with focus in its first field',
    )
    await evaluate(`document.activeElement.select()`)
    await type(token)
    await key('Enter', 'Enter', 13)
    await until(
      `!document.querySelector('#spec-sign-in-dialog')`,
      'the sign-in dialog did not close on Enter',
    )
    await until(
      `document.activeElement?.matches(${JSON.stringify(opener)})`,
      'focus did not return to the sign-in command',
    )
  }
  const outcome = () => evaluate<string>(`document.querySelector('[data-spec-outcome]')?.textContent ?? ''`)
  const exceptions = () => page.events.filter((event) => event.method === 'Runtime.exceptionThrown')
  const consoleErrors = () =>
    page.events.filter(
      (event) => event.method === 'Runtime.consoleAPICalled' && (event.params as Json).type === 'error',
    )

  // -------------------------------------------------------------------------
  // Behaviour, at desktop width in the light theme.
  console.log('behaviour')
  await viewport(1440)
  await open('/spec?theme=light')
  assert.equal(await evaluate<string>('document.title'), 'Orders API · Spec')
  assert.equal(await evaluate<string>(`document.querySelector('h1')?.textContent`), 'Orders API')
  assert.equal(
    await evaluate<string>('document.documentElement.dataset.kvInteractions ?? "none"'),
    'none',
    'the page binds the runtime itself, not auto.js',
  )
  const brand = await evaluate<Json>(`(() => {
    const images = [...document.querySelectorAll('[data-ui="app-sidebar"] [data-ui="app-brand"] img')]
    return images.map((image) => ({ appearance: image.dataset.appearance, loaded: image.complete && image.naturalWidth > 0, display: getComputedStyle(image).display, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, alt: image.alt }))
  })()`)
  check('overview renders with the Spec brand', { brand })

  // Navigation is in place, focus moves to the content, Back restores.
  await evaluate(
    `document.querySelector('[data-ui="navigation-item"][href$="operation=listOrders"]').click()`,
  )
  await until(
    `location.search === '?theme=light&operation=listOrders' && document.querySelector('h1')?.textContent === 'List orders'`,
    'navigation did not open the operation',
  )
  assert.equal(await evaluate<string>('document.title'), 'List orders · Orders API · Spec')
  assert.equal(
    await evaluate<string>(`document.activeElement?.closest('[data-spec-region]')?.dataset.specRegion`),
    'main',
  )
  assert.equal(
    await evaluate<string>(`document.querySelector('[aria-current="page"]')?.getAttribute('href')`),
    '/spec?theme=light&operation=listOrders',
  )
  await page.send('Runtime.evaluate', { expression: 'history.back()' })
  await until(
    `document.querySelector('h1')?.textContent === 'Orders API'`,
    'Back did not restore the overview',
  )
  check('navigation pushes, focuses the content and restores on Back')

  // Search: Ctrl/Cmd+K opens the dialog, Enter shows the results.
  await key('k', 'KeyK', 75, process.platform === 'darwin' ? 4 : 2)
  await until(
    `document.querySelector('#spec-search')?.open === true || !!document.querySelector('[data-ui="modal-layer"] [data-ui="global-search-input"]')`,
    'the search shortcut did not open the dialog',
  )
  await until(
    `document.activeElement?.matches('[data-ui="global-search-input"]')`,
    'search input not focused',
  )
  await type('order create')
  await key('Enter', 'Enter', 13)
  await until(`new URLSearchParams(location.search).get('q') === 'order create'`, 'search did not navigate')
  await until(
    `document.querySelectorAll('[data-spec-region="main"] a[href*="operation=createOrder"]').length > 0`,
    'search results missing createOrder',
  )
  const searchRows = await evaluate<number>(
    `document.querySelectorAll('[data-spec-region="main"] a[href*="operation="]').length`,
  )
  assert.equal(searchRows, 1)
  await open('/spec?q=sales.order.read')
  assert.ok(
    (await evaluate<string>(`document.querySelector('[data-spec-region="main"]').textContent`)).includes(
      'List orders',
    ),
  )
  check('search opens from the keyboard and matches summaries and capabilities', { searchRows })

  // Try it: success.
  await open('/spec?operation=listOrders')
  await until(
    `document.querySelector('[data-spec-try] ~ * [data-ui="code-block"], [data-ui="disclosure"] [data-ui="code-block"]') !== null`,
    'curl preview missing',
  )
  await send()
  await until(
    `document.querySelector('[data-spec-outcome]')?.textContent.includes('200')`,
    'GET did not succeed',
  )
  assert.ok((await outcome()).includes('First'))
  check('try-it sends a public request and shows the answer')

  // Validation stays on the fields and focuses the first one.
  await open('/spec?operation=createOrder')
  assert.equal(await fill('body', '{ not json'), true)
  await send()
  await until(`document.querySelector('[aria-invalid="true"]') !== null`, 'invalid fields not marked')
  const invalid = await evaluate<Json>(`({
    fields: [...document.querySelectorAll('#spec-try [aria-invalid="true"]')].map((field) => field.name),
    focused: document.activeElement?.name,
  })`)
  assert.deepEqual(invalid.fields, ['auth.bearer', 'body'])
  assert.equal(invalid.focused, 'auth.bearer')
  assert.equal(received.length, 1, 'nothing is sent while fields are invalid')
  check('invalid input is refused on its fields before sending', invalid)

  // The KetJS envelope, with a credential that never leaves memory.
  const secret = 'e2e-secret-token-7f3a'
  // Sign in is a modal dialog: the shell is inert, Escape closes it and focus returns.
  await evaluate(
    `document.querySelector('#spec-sign-in').focus(); document.querySelector('#spec-sign-in').click()`,
  )
  await until(`!!document.querySelector('#spec-sign-in-dialog')`, 'the sign-in dialog did not open')
  const dialog = await evaluate<Json>(`({
    label: document.querySelector('#spec-sign-in').textContent.trim(),
    role: document.querySelector('#spec-sign-in-dialog').getAttribute('role'),
    shellInert: document.querySelector('[data-ui="app-shell"]')?.closest('[inert]') !== null,
    fields: [...document.querySelectorAll('#spec-sign-in-form input')].map((input) => input.name),
  })`)
  assert.deepEqual(dialog, { label: 'Sign in', role: 'dialog', shellInert: true, fields: ['auth.bearer'] })
  await page
    .send('Page.captureScreenshot', { format: 'png' })
    .then((capture) =>
      writeFileSync(join(evidence, 'sign-in-dialog.png'), Buffer.from(String(capture.data), 'base64')),
    )
  await key('Escape', 'Escape', 27)
  await until(`!document.querySelector('#spec-sign-in-dialog')`, 'Escape did not close the dialog')
  await until(`document.activeElement?.matches('#spec-sign-in')`, 'Escape did not return focus')
  assert.equal(
    await evaluate<boolean>(`document.querySelector('[data-ui="app-shell"]').closest('[inert]') === null`),
    true,
  )
  await signIn(secret)
  const signedIn = await evaluate<Json>(`({
    label: document.querySelector('#spec-sign-in').textContent.trim(),
    field: document.querySelector('#spec-try').elements.namedItem('auth.bearer').value === ${JSON.stringify(secret)},
    readOnly: document.querySelector('#spec-try').elements.namedItem('auth.bearer').readOnly,
    invalid: document.querySelectorAll('#spec-try [name="auth.bearer"][aria-invalid="true"]').length,
    tryCommand: document.querySelector('#spec-try-sign-in')?.textContent.trim(),
  })`)
  assert.deepEqual(signedIn, {
    label: 'Signed in',
    field: true,
    readOnly: true,
    invalid: 0,
    tryCommand: 'Change credentials',
  })
  check('Sign in is a modal dialog; Escape closes it, Enter saves, focus returns', { dialog, signedIn })
  await fill('body', '{}')
  await until(
    `[...document.querySelectorAll('[data-ui="code-block"]')].some((block) => block.textContent.includes('Bearer ••••••'))`,
    'curl preview did not mask the token',
    60,
  )
  await send()
  await until(`document.querySelector('[data-spec-outcome]')?.textContent.includes('422')`, '422 not shown')
  const envelope = await outcome()
  assert.ok(envelope.includes('Some fields need attention.'))
  assert.ok(envelope.includes('req-e2e-422'))
  assert.ok(envelope.includes('note'))
  const sent = received.at(-1)
  assert.equal(sent?.headers.authorization, `Bearer ${secret}`)
  assert.equal(sent?.headers['content-type'], 'application/json')
  const leaks = await evaluate<Json>(`({
    url: location.href.includes(${JSON.stringify(secret)}),
    storage: JSON.stringify({ ...localStorage, ...sessionStorage }).includes(${JSON.stringify(secret)}),
    markup: document.documentElement.outerHTML.replace(/value="[^"]*"/g, '').includes(${JSON.stringify(secret)}),
  })`)
  assert.deepEqual(leaks, { url: false, storage: false, markup: false })
  check('a 422 shows the error envelope; the token is sent but not stored or shown', { leaks })
  await page
    .send('Page.captureScreenshot', { format: 'png' })
    .then((capture) =>
      writeFileSync(join(evidence, 'behaviour-422.png'), Buffer.from(String(capture.data), 'base64')),
    )

  // Drafts survive navigation; the credential is kept for the session.
  await fill('body', '{ "note": "Ring twice" }')
  await open('/spec?operation=createOrder')
  await evaluate(
    `document.querySelector('[data-ui="navigation-item"][href$="operation=listOrders"]').click()`,
  )
  await until(`document.querySelector('h1')?.textContent === 'List orders'`, 'did not leave')
  await page.send('Runtime.evaluate', { expression: 'history.back()' })
  await until(`document.querySelector('h1')?.textContent === 'Create an order'`, 'did not return')
  // A full reload starts clean: drafts and secrets are memory-only.
  const afterReload = await evaluate<Json>(
    `({ token: document.querySelector('#spec-try').elements.namedItem('auth.bearer').value })`,
  )
  assert.equal(afterReload.token, '')
  await signIn(secret, '#spec-try-sign-in')
  await fill('body', '{ "note": "Ring twice" }')
  await evaluate(
    `document.querySelector('[data-ui="navigation-item"][href$="operation=listOrders"]').click()`,
  )
  await until(`document.querySelector('h1')?.textContent === 'List orders'`, 'did not leave')
  await page.send('Runtime.evaluate', { expression: 'history.back()' })
  await until(`document.querySelector('h1')?.textContent === 'Create an order'`, 'did not return')
  const kept = await evaluate<Json>(
    `(() => { const form = document.querySelector('#spec-try'); return { token: form.elements.namedItem('auth.bearer').value === ${JSON.stringify(secret)}, body: form.elements.namedItem('body').value } })()`,
  )
  assert.deepEqual(kept, { token: true, body: '{ "note": "Ring twice" }' })
  await send()
  await until(`document.querySelector('[data-spec-outcome]')?.textContent.includes('201')`, '201 not shown')
  check('drafts survive in-place navigation and a reload starts clean', { afterReload, kept })

  // Network failure, timeout, cancel and offline are told apart.
  await fill('server', `http://127.0.0.1:${closedPort}`)
  await send()
  await until(
    `document.querySelector('[data-spec-outcome]')?.textContent.includes('CORS')`,
    'network failure not reported',
  )
  check('an unreachable server is reported as a network failure')

  await open('/spec?operation=slowReport')
  await send()
  await until(`document.querySelector('#spec-try-cancel') !== null`, 'cancel not offered while sending')
  assert.equal(
    await evaluate<string>(`document.querySelector('#spec-try').getAttribute('aria-busy')`),
    'true',
  )
  await evaluate(`document.querySelector('#spec-try-cancel').click()`)
  await until(
    `document.querySelector('[data-spec-outcome]')?.textContent.includes('cancelled')`,
    'cancel not reported',
  )
  check('a sending request can be cancelled')
  await send()
  await until(
    `document.querySelector('[data-spec-outcome]')?.textContent.includes('2 seconds')`,
    'timeout not reported',
    120,
  )
  check('an unanswered request times out')

  await page.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await until('navigator.onLine === false', 'offline emulation failed')
  await send()
  await until(
    `document.querySelector('[data-spec-outcome]')?.textContent.includes('offline')`,
    'offline not reported',
  )
  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await until(
    `!document.querySelector('[data-spec-outcome]')?.textContent.includes('offline')`,
    'reconnecting did not clear the offline notice',
  )
  check('offline is reported and cleared on reconnect')

  // A described document that fails to load can be retried.
  await open('/remote', 'failed')
  assert.ok(
    (await evaluate<string>(`document.querySelector('[data-spec-region="main"]').textContent`)).includes(
      '503',
    ),
  )
  await evaluate(`document.querySelector('#spec-retry').click()`)
  await until(`document.querySelector('#spec').dataset.specState === 'ready'`, 'retry did not load')
  await key('k', 'KeyK', 75, process.platform === 'darwin' ? 4 : 2)
  await until(
    `document.activeElement?.matches('[data-ui="global-search-input"]')`,
    'search not rebound after retry',
  )
  await key('Escape', 'Escape', 27)
  check('a failed load retries, and search works after it')

  // Keyboard: open a navigation group and an operation without a pointer.
  await open('/spec')
  const tabTo = async (expression: string, label: string) => {
    for (let step = 0; step < 15; step++) {
      await key('Tab', 'Tab', 9)
      if (await evaluate<boolean>(expression)) return
    }
    throw new Error(`Tab did not reach ${label}`)
  }
  await tabTo(
    `document.activeElement?.matches('[data-ui="navigation-branch-trigger"]') && document.activeElement.textContent.includes('orders')`,
    'the orders group',
  )
  await key('Enter', 'Enter', 13)
  await until(`document.activeElement?.closest('details')?.open === true`, 'Enter did not expand the group')
  await tabTo(
    `document.activeElement?.getAttribute('href')?.endsWith('operation=listOrders') === true`,
    'List orders',
  )
  await key('Enter', 'Enter', 13)
  await until(
    `document.querySelector('h1')?.textContent === 'List orders'`,
    'Enter did not open the operation',
  )
  await key('Tab', 'Tab', 9)
  const afterMain = await evaluate<string>(
    `document.activeElement?.closest('[data-spec-region]')?.dataset.specRegion ?? ''`,
  )
  assert.equal(afterMain, 'main')
  check('keyboard reaches and opens operations; Tab continues inside the content')

  // Ten thousand operations.
  const started = Date.now()
  await open('/large')
  const loadMs = Date.now() - started
  const largeNavigation = await evaluate<Json>(
    `({ branches: document.querySelectorAll('[data-ui="navigation-branch"]').length, links: document.querySelectorAll('[data-ui="navigation-item"]').length })`,
  )
  const searchStarted = Date.now()
  await open('/large?q=item4999')
  const searchMs = Date.now() - searchStarted
  const largeResults = await evaluate<number>(
    `document.querySelectorAll('[data-spec-region="main"] a[href*="operation="]').length`,
  )
  assert.equal(largeResults, 2)
  await open('/large?q=item')
  const capped = await evaluate<string>(`document.querySelector('[data-spec-region="main"]').textContent`)
  assert.ok(capped.includes('200'), 'a broad search says it shows the first 200')
  assert.ok(loadMs < 8000, `10k operations took ${loadMs} ms`)
  check('ten thousand operations load and search', { loadMs, searchMs, largeNavigation, largeResults })

  // -------------------------------------------------------------------------
  // Layout at each width and theme.
  console.log('layout')
  const measure = () =>
    evaluate<Json>(`(() => {
      const box = (selector) => { const element = document.querySelector(selector); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
      const visibleBrand = [...document.querySelectorAll('[data-ui="app-brand"] img')].find((image) => image.getBoundingClientRect().width > 0)
      const block = document.querySelector('[data-ui="code-block"]')
      const blockStyle = block ? getComputedStyle(block) : null
      return {
        overflowX: document.scrollingElement.scrollWidth - innerWidth,
        bodyMargin: getComputedStyle(document.body).margin,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        colorScheme: getComputedStyle(document.querySelector('#spec')).colorScheme,
        brand: visibleBrand ? { appearance: visibleBrand.dataset.appearance, loaded: visibleBrand.naturalWidth > 0, ...visibleBrand.getBoundingClientRect().toJSON() } : null,
        sidebar: box('[data-ui="app-sidebar"]'),
        main: box('[data-spec-region="main"]'),
        title: box('h1'),
        // The open branch's label and its first child's label, to measure the tree indent.
        indent: (() => { const branch = document.querySelector('[data-ui="navigation-branch"][open]'); const parent = branch?.querySelector(':scope > summary [data-ui="navigation-item-label"]'); const child = branch?.querySelector(':scope > [data-ui="navigation-children"] [data-ui="navigation-item-label"]'); const parentBox = parent?.getBoundingClientRect(); const childBox = child?.getBoundingClientRect(); return parentBox?.width && childBox?.width ? childBox.x - parentBox.x : null })(),
        labelColumn: (() => { const overview = document.querySelector('[data-ui="navigation-item"] [data-ui="navigation-item-label"]'); const group = document.querySelector('[data-ui="navigation-branch-trigger"] [data-ui="navigation-item-label"]'); return overview?.getClientRects().length && group?.getClientRects().length ? group.getBoundingClientRect().x - overview.getBoundingClientRect().x : null })(),
        caret: (() => { const icon = document.querySelector('[data-ui="navigation-branch"][open] > summary [data-caret="true"] [data-ui="icon"]'); const closed = document.querySelector('[data-ui="navigation-branch"]:not([open]) > summary [data-caret="true"] [data-ui="icon"]'); return icon ? { open: getComputedStyle(icon).rotate, closed: closed ? getComputedStyle(closed).rotate : null, width: icon.getBoundingClientRect().width } : null })(),
        content: (() => { const main = document.querySelector('[data-spec-region="main"]'); const column = main?.parentElement; if (!main || !column) return null; const box = main.getBoundingClientRect(); const outer = column.getBoundingClientRect(); return { width: box.width, left: box.left - outer.left, right: outer.right - box.right } })(),
        codeBlock: blockStyle ? { fontSize: blockStyle.fontSize, lineHeight: blockStyle.lineHeight, fontFamily: blockStyle.fontFamily, overflow: blockStyle.overflow, maxHeight: blockStyle.maxBlockSize } : null,
        clipped: [...document.querySelectorAll('[data-spec-region="main"] h1, [data-spec-region="main"] h2, [data-ui="navigation-item-label"]')].filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis').map((element) => element.textContent.slice(0, 40)),
      }
    })()`)
  const layouts: Json[] = []
  for (const theme of ['light', 'dark'] as const)
    for (const width of [1440, 1024, 768, 767, 390]) {
      await viewport(width)
      for (const [name, path] of [
        ['overview', `/staff?theme=${theme}`],
        ['operation', `/spec?theme=${theme}&operation=createOrder`],
      ] as const) {
        await open(path)
        if (name === 'operation') {
          await signIn(secret, '#spec-try-sign-in')
          await fill('body', '{}')
          await send()
          await until(
            `document.querySelector('[data-spec-outcome]')?.textContent.includes('422')`,
            '422 not shown',
          )
          await evaluate(`document.querySelector('#spec-try')?.scrollIntoView({ block: 'start' })`)
        }
        await delay(100)
        const metrics = await measure()
        assert.ok(
          Number(metrics.overflowX) <= 0,
          `${name} ${width} ${theme} scrolls sideways by ${metrics.overflowX}px`,
        )
        assert.equal(metrics.bodyMargin, '0px')
        // A forced theme reaches the document too, not only the design-system root.
        assert.equal(metrics.colorScheme, theme)
        assert.equal(metrics.bodyBackground, theme === 'light' ? 'rgb(247, 245, 245)' : 'rgb(27, 31, 36)')
        // The caret fills the icon column, so child labels align with their group's label.
        if (name === 'operation' && width >= 768) {
          assert.equal(metrics.indent, 0, `${width} ${theme} nav indent`)
          assert.equal(metrics.labelColumn, 0, `${width} ${theme} Overview and group labels share a column`)
          const caret = metrics.caret as Json
          assert.deepEqual(
            [caret.open, caret.closed, caret.width],
            ['90deg', 'none', 16],
            `${width} ${theme} caret`,
          )
        }
        // Content stops at the 1200px reading width and is centred in the main column.
        const content = metrics.content as Json
        assert.ok(
          Number(content.width) <= 1200,
          `${name} ${width} ${theme} content is ${content.width}px wide`,
        )
        assert.ok(
          Math.abs(Number(content.left) - Number(content.right)) <= 1,
          `${name} ${width} ${theme} content is not centred`,
        )
        assert.equal(
          (metrics.brand as Json | null)?.appearance ?? theme,
          theme,
          `${name} ${width} ${theme} shows the wrong logo`,
        )
        layouts.push({ name, width, theme, ...metrics })
        const capture = await page.send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(
          join(evidence, `${name}-${width}-${theme}.png`),
          Buffer.from(String(capture.data), 'base64'),
        )
      }
    }
  check('no sideways scrolling, body framed, the right logo per theme', { layouts: layouts.length })

  assert.deepEqual(exceptions(), [], 'uncaught exceptions')
  assert.deepEqual(consoleErrors(), [], 'console errors')
  check('no uncaught exceptions or console errors')
  writeFileSync(join(evidence, 'results.json'), `${JSON.stringify({ results, layouts }, null, 2)}\n`)
  console.log(`ketspec browser checks passed; evidence in ${evidence}`)
} catch (error) {
  if (cdp) {
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (capture) writeFileSync(join(evidence, 'failure.png'), Buffer.from(String(capture.data), 'base64'))
  }
  writeFileSync(join(evidence, 'results.json'), `${JSON.stringify({ results }, null, 2)}\n`)
  console.error(`evidence in ${evidence}`)
  throw error
} finally {
  cdp?.close()
  const exited = new Promise((resolve) => browser.once('exit', resolve))
  browser.kill()
  await exited
  app.close()
  app.closeAllConnections()
  rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
