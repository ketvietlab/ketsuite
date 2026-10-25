import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { collaborationEvidenceDeployment } from './collaboration-evidence-fixture.ts'

const CHROME = process.env.KET_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

class Cdp {
  readonly socket: WebSocket
  #id = 0
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  #events = new Map<string, Array<(params: unknown) => void>>()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id)
        if (!pending) return
        this.#pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed'))
        else pending.resolve(message.result)
        return
      }
      if (!message.method) return
      for (const listener of this.#events.get(message.method) ?? []) listener(message.params)
    })
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome DevTools WebSocket timed out')), 10_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolveOpen()
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Chrome DevTools WebSocket failed'))
      })
    })
    return new Cdp(socket)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.#id
    return new Promise<T>((resolveCommand, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolveCommand(value as T),
        reject,
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method: string, timeoutMs = 10_000): Promise<unknown> {
    return new Promise((resolveEvent, reject) => {
      const listeners = this.#events.get(method) ?? []
      const listener = (params: unknown) => {
        clearTimeout(timer)
        this.#events.set(
          method,
          (this.#events.get(method) ?? []).filter((entry) => entry !== listener),
        )
        resolveEvent(params)
      }
      listeners.push(listener)
      this.#events.set(method, listeners)
      const timer = setTimeout(() => {
        this.#events.set(
          method,
          (this.#events.get(method) ?? []).filter((entry) => entry !== listener),
        )
        reject(new Error(`timed out waiting for ${method}`))
      }, timeoutMs)
    })
  }

  on(method: string, listener: (params: unknown) => void): void {
    const listeners = this.#events.get(method) ?? []
    listeners.push(listener)
    this.#events.set(method, listeners)
  }

  close(): void {
    this.socket.close()
  }
}

type ChromeHandle = { process: ChildProcess; profile: string; cdp: Cdp }

const startChrome = async (): Promise<ChromeHandle> => {
  const profile = await mkdtemp(join(tmpdir(), 'ket-collaboration-chrome-'))
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1440,1100',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const browserSocket = await new Promise<string>((resolveSocket, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools: ${stderr}`)), 15_000)
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
      if (!match) return
      clearTimeout(timer)
      resolveSocket(match[1]!)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Chrome exited before DevTools was ready (${String(code)}): ${stderr}`))
    })
  })
  const endpoint = new URL(browserSocket)
  let target: { webSocketDebuggerUrl?: string } | undefined
  for (let attempt = 0; attempt < 50 && !target?.webSocketDebuggerUrl; attempt++) {
    const list = (await fetch(`http://${endpoint.host}/json/list`).then((response) =>
      response.json(),
    )) as Array<{
      type?: string
      webSocketDebuggerUrl?: string
    }>
    target = list.find((entry) => entry.type === 'page')
    if (!target?.webSocketDebuggerUrl) await delay(100)
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome exposed no page target')
  return { process: child, profile, cdp: await Cdp.connect(target.webSocketDebuggerUrl) }
}

const evaluate = async <T>(cdp: Cdp, expression: string): Promise<T> => {
  const response = await cdp.send<{
    result: { value?: T; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'browser evaluation failed',
    )
  return response.result.value as T
}

const navigate = async (cdp: Cdp, url: string): Promise<void> => {
  const loaded = cdp.once('Page.loadEventFired', 15_000)
  await cdp.send('Page.navigate', { url })
  await loaded
  // The load event does not wait for the KetJS bootstrap's top-level await, so a
  // form submitted right after it can beat the behavior that saves it in place.
  // The bootstrap publishes its navigation once islands and behaviors are mounted.
  await waitFor(
    cdp,
    `!document.querySelector('script[src="/_ket/islands.js"]') || globalThis.__ketNavigation`,
    15_000,
  )
}

const waitFor = async (cdp: Cdp, expression: string, timeoutMs = 10_000): Promise<void> => {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (await evaluate<boolean>(cdp, `Boolean(${expression})`)) return
    await delay(100)
  }
  const diagnostic = await evaluate(
    cdp,
    `({
    url: location.href,
    chatter: document.querySelector('[data-ui="chatter"]')?.outerHTML ?? null,
    activity: document.querySelector('[data-ui="activity-record"]')?.outerHTML ?? null,
    body: document.body?.innerText?.slice(-1200) ?? null
  })`,
  )
  throw new Error(`browser condition timed out: ${expression}\n${JSON.stringify(diagnostic, null, 2)}`)
}

const capture = async (cdp: Cdp, path: string): Promise<void> => {
  const result = await cdp.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
  })
  await writeFile(path, Buffer.from(result.data, 'base64'))
}

/**
 * A page script that starts the browser clock at `instant` and lets it run on from there,
 * for screens that open on today while the fixture's records sit on a fixed day.
 */
const shiftedClock = (instant: string): string => `(() => {
  const offset = ${Date.parse(instant)} - Date.now()
  const Real = Date
  globalThis.Date = class extends Real {
    constructor(...args) { super(...(args.length ? args : [Real.now() + offset])) }
    static now() { return Real.now() + offset }
  }
})()`

/** The form a record modal of one kind shows, as a browser expression. */
const recordForm = (kind: string): string =>
  `document.querySelector('[role="dialog"] form[data-record-kind="${kind}"]')`

/** The record modal shows a saved record of the kind, not the blank one it opened with. */
const openedRecord = (kind: string): string =>
  `(new URLSearchParams(location.search).get('record') ?? '').startsWith('${kind}:') && !location.search.includes('${encodeURIComponent(`${kind}:`)}new')`

/**
 * Fill a record modal form as typing does, then submit it through the record runtime,
 * with the button of `command` when the form offers more than one.
 */
const submitRecordForm = async (
  cdp: Cdp,
  kind: string,
  values: Record<string, string>,
  command?: string,
): Promise<void> => {
  await evaluate(
    cdp,
    `(() => {
      const form = ${recordForm(kind)}
      for (const [name, value] of Object.entries(${JSON.stringify(values)})) {
        const control = form.querySelector('[name="' + name + '"]')
        control.value = value
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const command = ${JSON.stringify(command ?? null)}
      form.requestSubmit(command ? form.querySelector('button[name="__command"][value="' + command + '"]') : undefined)
      return true
    })()`,
  )
}

/** A create record modal: its form, field rows, and a page that neither scrolls sideways nor shows a chatter. */
const createModalLayout = (cdp: Cdp, kind: string) =>
  evaluate<Record<string, boolean>>(
    cdp,
    `(() => {
      const form = ${recordForm(kind)}
      return {
        recordModal: Boolean(form),
        fieldsAtLeast28: Array.from(form?.querySelectorAll('[data-ui="field"]') ?? []).every((field) => field.getBoundingClientRect().height >= 28),
        chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })()`,
  )

const e2e = await collaborationEvidenceDeployment()
let chrome: ChromeHandle | null = null
const artifactDir = resolve('docs/public/assets/collaboration')
const productListEvidenceDir = resolve('docs/public/assets/product-list')
const partnerListEvidenceDir = resolve('docs/public/assets/partner-list')
const partnerFormEvidenceDir = resolve('docs/public/assets/partner-form')
const lotEvidenceDir = resolve('docs/public/assets/inventory-lot-list')
const transferEvidenceDir = resolve('docs/public/assets/inventory-transfer-list')
const routeEvidenceDir = resolve('docs/public/assets/inventory-route-list')
const routeDetailEvidenceDir = resolve('docs/public/assets/inventory-route-detail')
const replenishmentEvidenceDir = resolve('docs/public/assets/inventory-replenishment')
const forecastEvidenceDir = resolve('docs/public/assets/inventory-forecast')
const quotationEvidenceDir = resolve('docs/public/assets/sales-quotation-list')
const quotationCreateEvidenceDir = resolve('docs/public/assets/sales-quotation-create')
const vendorPricelistEvidenceDir = resolve('docs/public/assets/purchase-vendor-pricelists')
const crmPipelineEvidenceDir = resolve('docs/public/assets/crm-pipeline')
const crmCasesEvidenceDir = resolve('docs/public/assets/crm-cases')
const salesOverviewEvidenceDir = resolve('docs/public/assets/sales-overview')
const purchaseOverviewEvidenceDir = resolve('docs/public/assets/purchase-overview')
const saleOrderEvidenceDir = resolve('docs/public/assets/sales-order-detail')
const salesOrderListEvidenceDir = resolve('docs/public/assets/sales-order-list')
const invoicingPolicyEvidenceDir = resolve('docs/public/assets/sales-invoicing-policy')
const report: Array<{ screen: string; readyMs: number; navigationMs: number }> = []
const onlyScreen = process.env.KET_E2E_SCREEN?.trim()
const noArtifacts = process.env.KET_E2E_NO_ARTIFACTS === '1'
try {
  await mkdir(artifactDir, { recursive: true })
  await mkdir(productListEvidenceDir, { recursive: true })
  await mkdir(partnerListEvidenceDir, { recursive: true })
  await mkdir(partnerFormEvidenceDir, { recursive: true })
  await mkdir(lotEvidenceDir, { recursive: true })
  await mkdir(transferEvidenceDir, { recursive: true })
  await mkdir(routeEvidenceDir, { recursive: true })
  await mkdir(routeDetailEvidenceDir, { recursive: true })
  await mkdir(replenishmentEvidenceDir, { recursive: true })
  await mkdir(forecastEvidenceDir, { recursive: true })
  await mkdir(quotationEvidenceDir, { recursive: true })
  await mkdir(quotationCreateEvidenceDir, { recursive: true })
  await mkdir(vendorPricelistEvidenceDir, { recursive: true })
  await mkdir(crmPipelineEvidenceDir, { recursive: true })
  await mkdir(crmCasesEvidenceDir, { recursive: true })
  await mkdir(salesOverviewEvidenceDir, { recursive: true })
  await mkdir(purchaseOverviewEvidenceDir, { recursive: true })
  await mkdir(saleOrderEvidenceDir, { recursive: true })
  await mkdir(salesOrderListEvidenceDir, { recursive: true })
  await mkdir(invoicingPolicyEvidenceDir, { recursive: true })
  chrome = await startChrome()
  const { cdp } = chrome
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  cdp.on('Runtime.exceptionThrown', (params) => console.error(`browser exception: ${JSON.stringify(params)}`))
  cdp.on('Log.entryAdded', (params) => console.error(`browser log: ${JSON.stringify(params)}`))
  await navigate(cdp, `${e2e.baseUrl}/login?lang=vi`)
  const login = await evaluate<{ status: number; ok: boolean }>(
    cdp,
    `(async () => {
      const response = await fetch('/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({login: 'admin', password: 'correct horse'})
      })
      return {status: response.status, ok: response.ok}
    })()`,
  )
  assert.deepEqual(login, { status: 200, ok: true })

  for (const screen of [
    {
      name: 'product-list',
      path: '/admin/product/templates?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 6`,
    },
    {
      name: 'partner-list',
      path: '/admin/partner/partners?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 6`,
    },
    {
      name: 'partner-form',
      path: '/admin/partner/partners/directory-partner-01?lang=vi',
      ready: `document.querySelector('[data-ui="form-page"]') && document.querySelector('#partner-identity-form')`,
    },
    {
      name: 'product-chatter',
      path: '/admin/product/templates/tpl-collab?lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="chatter-delivery"][data-state="failed"]') && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'product-variant-chatter',
      path: '/admin/product/templates/tpl-collab/variants/variant-collab?tab=general&lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'product-favorite',
      path: '/admin/product/templates/favorites/new?returnTo=%2Fadmin%2Fproduct%2Ftemplates%3Fq%3DOPS&lang=vi',
      ready: `document.querySelector('[data-route-modal="true"] #product-favorite-create-form') && document.querySelector('[data-ui="list-page"]')`,
    },
    {
      name: 'product-attributes',
      path: '/admin/product/attributes?lang=vi&record=product.attribute%3Anew',
      ready: `${recordForm('product.attribute')}?.querySelector('[name="name"]') && document.querySelectorAll('[data-ui="kt-row"]').length >= 3`,
    },
    {
      name: 'product-create',
      path: '/admin/product/templates/new?lang=vi',
      ready: `document.querySelector('[data-ui="record-page-body"] form#product-record [name="name"]')`,
    },
    {
      name: 'transfer-chatter',
      path: '/admin/stock/transfers/pick-collab?lang=vi',
      ready: `document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="chatter-delivery"][data-state="sent"]') && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'inventory-adjustment',
      path: '/admin/stock/inventory?lang=vi&record=stock.count%3Anew',
      ready: `${recordForm('stock.count')}?.querySelector('[name="productId"]') && document.querySelectorAll('[data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'transfer-list',
      path: '/admin/stock/transfers?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'transfer-create',
      path: '/admin/stock/transfers/new?lang=vi',
      ready: `document.querySelector('[data-ui="form-page"]') && document.querySelector('#transfer-create-form')`,
    },
    {
      name: 'warehouse-list',
      path: '/admin/stock/warehouses?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'warehouse-create',
      path: '/admin/stock/warehouses?lang=vi&record=stock.warehouse%3Anew',
      ready: `${recordForm('stock.warehouse')}?.querySelector('[name="name"]')`,
    },
    {
      name: 'location-list',
      path: '/admin/stock/locations?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'location-create',
      path: '/admin/stock/locations?lang=vi&record=stock.location%3Anew',
      ready: `${recordForm('stock.location')}?.querySelector('[name="name"]')`,
    },
    {
      name: 'operation-type-list',
      path: '/admin/stock/picking-types?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'operation-type-create',
      path: '/admin/stock/picking-types?lang=vi&record=stock.pickingType%3Anew',
      ready: `${recordForm('stock.pickingType')}?.querySelector('[name="name"]')`,
    },
    {
      name: 'route-list',
      path: '/admin/stock/routes?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'route-create',
      path: '/admin/stock/routes?lang=vi&record=stock.route%3Anew',
      ready: `${recordForm('stock.route')}?.querySelector('[name="name"]')`,
    },
    {
      name: 'route-detail',
      path: '/admin/stock/routes/wh:receipt-route?lang=vi',
      ready: `document.querySelector('#stock-route-detail-form') && document.querySelector('#stock-route-rule-form') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'replenishment',
      path: '/admin/stock/replenishment?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'replenishment-create',
      path: '/admin/stock/replenishment/new?lang=vi',
      ready: `document.querySelector('[data-ui="form-page"]') && document.querySelector('#replenishment-create-form')`,
    },
    {
      name: 'forecast',
      path: '/admin/stock/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=vi',
      ready: `document.querySelector('#forecast-filter-form') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length === 1`,
    },
    {
      name: 'quotation-list',
      path: '/admin/sales/quotations?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'quotation-create',
      path: '/admin/sales/quotations/new?state=draft&lang=vi',
      ready: `document.querySelector('[data-ui="form-page"]') && document.querySelector('#quotation-create-form')`,
    },
    {
      name: 'vendor-pricelist-list',
      path: '/admin/purchase/vendor-pricelists?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelector('form [name="action"][value="method"]')`,
    },
    {
      name: 'vendor-pricelist-create',
      path: '/admin/purchase/vendor-pricelists/new?lang=vi',
      ready: `document.querySelector('[data-ui="form-page"]') && document.querySelector('#purchase-vendor-pricelist-create')`,
    },
    {
      name: 'crm-pipeline',
      path: '/admin/crm/pipeline?lang=vi',
      ready: `document.querySelector('[data-ui="board-page"] [data-crm-board][role="region"]')`,
    },
    {
      name: 'crm-cases-list',
      path: '/admin/crm/cases?lang=vi',
      // The sales-screen island draws the page from a read it makes after mounting.
      ready: `document.querySelector('[data-ui="list-page"] a[href*="/admin/crm/cases/new"]')`,
    },
    {
      name: 'crm-case-create',
      path: '/admin/crm/cases/new?kind=lead&lang=vi',
      ready: `document.querySelector('[data-ui="record-page"] form#sales-create [name="name"]')`,
    },
    {
      name: 'sales-overview',
      path: '/admin/sales?lang=vi',
      ready: `document.querySelector('[data-ui="dashboard-page"]') && document.querySelectorAll('[data-ui="metric"]').length === 4`,
    },
    {
      name: 'purchase-overview',
      path: '/admin/purchase?lang=vi',
      ready: `document.querySelector('[data-ui="dashboard-page"]') && document.querySelectorAll('[data-ui="metric"]').length === 5`,
    },
    {
      name: 'sale-order-detail',
      path: '/admin/sales/quotations/quotation-collab?lang=vi',
      ready: `document.querySelector('#sale-order-line-form') && document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'sales-order-list',
      path: '/admin/sales/orders?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'sales-invoicing-policy',
      path: '/admin/sales/invoicing-policies?lang=vi&record=sale.invoicePolicy%3Anew',
      ready: `${recordForm('sale.invoicePolicy')}?.querySelector('[name="templateId"]') && document.querySelectorAll('[data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'lot-list',
      path: '/admin/stock/lots?lang=vi',
      ready: `document.querySelector('[data-ui="list-page"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1`,
    },
    {
      name: 'lot-create',
      path: '/admin/stock/lots?lang=vi&record=stock.lot%3Anew',
      ready: `${recordForm('stock.lot')}?.querySelector('[name="name"]')`,
    },
    {
      name: 'lot-detail-chatter',
      path: '/admin/stock/lots/lot-collab?lang=vi',
      ready: `document.querySelector('#lot-detail-form') && document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.querySelectorAll('[data-ui="chatter-message"]').length >= 2 && document.querySelector('[data-ui="activity-record"][data-state="ready"]') && document.querySelectorAll('[data-ui="activity-item"]').length >= 1`,
    },
    {
      name: 'notification-inbox',
      path: '/admin/inbox?lang=vi',
      ready: `document.querySelector('[data-ui="content-card"]')`,
    },
    {
      name: 'my-activities',
      path: '/admin/activities?lang=vi&today=2026-08-20',
      ready: `document.querySelector('[data-ui="content-card"]') && document.body.textContent.includes('Xác nhận quy cách đóng gói')`,
    },
    {
      name: 'calendar-agenda',
      path: '/admin/calendar?lang=vi&view=agenda',
      // The agenda opens on today; the fixture's events are on 20 August 2026.
      clock: '2026-08-20T01:00:00.000Z',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="agenda"]') && document.querySelectorAll('[data-ui="calendar-event"]').length >= 2`,
    },
    {
      name: 'calendar-week',
      path: '/admin/calendar?lang=vi&view=week',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="week"]') && document.querySelectorAll('[data-ui="calendar-day"]').length === 7`,
    },
    {
      name: 'calendar-month',
      path: '/admin/calendar?lang=vi&view=month',
      ready: `document.querySelector('[data-ui="calendar-board"][data-state="ready"][data-view="month"]') && document.querySelectorAll('[data-ui="calendar-day"]').length === 42`,
    },
    {
      name: 'transactional-outbox',
      path: '/admin/outbox?lang=vi',
      ready: `document.querySelectorAll('[data-ui="content-card"]').length >= 2 && document.body.textContent.includes('Gửi lỗi') && document.body.textContent.includes('Đã gửi')`,
    },
    {
      name: 'inbound-email-log',
      path: '/admin/inbound-email?lang=vi',
      ready: `document.querySelectorAll('[data-ui="content-card"]').length >= 4 && document.body.textContent.includes('Đã xử lý') && document.body.textContent.includes('Không định tuyến được') && document.body.textContent.includes('Đã bỏ qua')`,
    },
  ].filter((screen) => !onlyScreen || screen.name === onlyScreen)) {
    if (['lot-detail-chatter', 'transfer-chatter'].includes(screen.name))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    const clock = screen.clock
      ? await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
          source: shiftedClock(screen.clock),
        })
      : null
    const started = performance.now()
    await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
    const navigationMs = await evaluate<number>(
      cdp,
      `performance.getEntriesByType('navigation')[0]?.duration ?? 0`,
    )
    await waitFor(cdp, screen.ready, 15_000)
    const readyMs = performance.now() - started
    assert.deepEqual(
      await evaluate<string[]>(
        cdp,
        `[...new Set(document.body.innerText.match(/\\b(?:recordModal|[a-z]+_backend)\\.[a-zA-Z][\\w.]*/g) ?? [])]`,
      ),
      [],
      `${screen.name}: every label is translated`,
    )
    report.push({ screen: screen.name, readyMs, navigationMs })

    if (screen.name === 'product-list') {
      const states = [
        {
          id: 'list',
          query: '',
          // The server draws placeholder rows; wait for the island's own.
          ready: `document.querySelector('[data-ui="ket-table"]:not([data-loading])') && document.querySelectorAll('[data-ui="kt-row"]:not([data-row^="loading-"])').length >= 6`,
        },
        {
          id: 'kanban',
          query: '&view=kanban',
          ready: `document.querySelectorAll('[data-ui="content-card"]').length >= 6`,
        },
        {
          id: 'empty',
          query: '&q=__missing_product__',
          ready: `document.querySelector('[data-ui="empty"]')`,
        },
      ]
      const viewports = [
        { id: 'wide', width: 3110, height: 900, mobile: false },
        { id: 'desktop', width: 1440, height: 1000, mobile: false },
        { id: 'mobile', width: 390, height: 844, mobile: true },
      ]
      for (const viewport of viewports) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        })
        for (const lang of ['vi', 'en']) {
          for (const state of states) {
            await navigate(cdp, `${e2e.baseUrl}/admin/product/templates?lang=${lang}${state.query}`)
            await waitFor(cdp, state.ready)
            const layout = await evaluate<{
              pageContained: boolean
              noPageOverflow: boolean
              titleVisible: boolean
              actionVisible: boolean
              controlsVisible: boolean
              searchBounded: boolean
              tailAtRight: boolean
              toolbarFullWidth: boolean
              ordered: boolean
              tableContained: boolean
            }>(
              cdp,
              `(() => {
                const page = document.querySelector('[data-ui="list-page"]')
              const header = document.querySelector('[data-ui="list-page-header"]')
              const title = document.querySelector('[data-ui="list-page-title"]')
              const action = document.querySelector('[data-ui="list-page-actions"] [data-ui="action"]')
              const toolbar = document.querySelector('[data-ui="list-page-toolbar"]')
              const controls = document.querySelector('[data-ui="list-page-controls"]')
                const search = document.querySelector('[data-ui="list-page-controls"] [data-ui="search-filter"]')
                const tail = document.querySelector('[data-ui="list-page-controls"] [data-ui="list-view-switch"]')
                const body = document.querySelector('[data-ui="list-page-body"]')
                const table = document.querySelector('[data-ui="kt-scroll"]')
                const pageBox = page.getBoundingClientRect()
                const headerBox = header.getBoundingClientRect()
                const titleBox = title.getBoundingClientRect()
              const actionBox = action.getBoundingClientRect()
              const toolbarBox = toolbar.getBoundingClientRect()
              const controlsBox = controls.getBoundingClientRect()
                const searchBox = search.getBoundingClientRect()
                const tailBox = tail.getBoundingClientRect()
                const bodyBox = body.getBoundingClientRect()
                const tableBox = table?.getBoundingClientRect()
                return {
                  pageContained: pageBox.left >= -1 && pageBox.right <= innerWidth + 1,
                  noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
                  titleVisible: titleBox.width > 0 && titleBox.height > 0 && title.scrollWidth <= title.clientWidth + 1,
                  actionVisible: actionBox.width > 0 && actionBox.height >= 30,
                  controlsVisible: controlsBox.width > 0 && controlsBox.height > 0,
                  searchBounded: searchBox.width <= 801,
                  tailAtRight: ${String(viewport.mobile)} ||
                    (tailBox.right <= toolbarBox.right &&
                      toolbarBox.right - tailBox.right <= 12),
                  // The toolbar may bleed to the edge on a phone; its content lines up with the body's.
                  toolbarFullWidth: (() => {
                    const inner = (node) => {
                      const box = node.getBoundingClientRect()
                      const style = getComputedStyle(node)
                      return [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)]
                    }
                    const [toolbarLeft, toolbarRight] = inner(toolbar)
                    const [bodyLeft, bodyRight] = inner(body)
                    return Math.abs(toolbarLeft - bodyLeft) <= 1 && Math.abs(toolbarRight - bodyRight) <= 1
                  })(),
                ordered: headerBox.bottom <= toolbarBox.top + 1 &&
                  toolbarBox.bottom <= bodyBox.top + 1 &&
                  searchBox.top >= toolbarBox.top - 1 && searchBox.bottom <= toolbarBox.bottom + 1 &&
                  controlsBox.top >= toolbarBox.top - 1 && controlsBox.bottom <= toolbarBox.bottom + 1,
                  tableContained: !tableBox || (tableBox.left >= pageBox.left - 1 && tableBox.right <= pageBox.right + 1)
                }
              })()`,
            )
            assert.deepEqual(
              layout,
              {
                pageContained: true,
                noPageOverflow: true,
                titleVisible: true,
                actionVisible: true,
                controlsVisible: true,
                searchBounded: true,
                tailAtRight: true,
                toolbarFullWidth: true,
                ordered: true,
                tableContained: true,
              },
              `${viewport.id}/${lang}/${state.id}`,
            )
            if (state.id === 'list') {
              // A selection replaces the search row with the bulk bar, in the same toolbar.
              await evaluate(cdp, `document.querySelector('[data-ui="kt-row-select"]').click()`)
              await waitFor(
                cdp,
                `document.querySelector('[data-ui="list-page-controls"] [data-ui="bulk-actions"]')`,
              )
              assert.deepEqual(
                await evaluate(
                  cdp,
                  `(() => {
                    const toolbar = document.querySelector('[data-ui="list-page-toolbar"]').getBoundingClientRect()
                    const bulk = document.querySelector('[data-ui="list-page-controls"] [data-ui="bulk-actions"]')
                    const box = bulk.getBoundingClientRect()
                    return {
                      visible: box.width > 0 && box.height > 0,
                      inToolbar: box.top >= toolbar.top - 1 && box.bottom <= toolbar.bottom + 1,
                      replacesQuery: !document.querySelector('[data-ui="list-page-controls"] [data-ui="list-query"]'),
                      counted: /1/.test(bulk.querySelector('[data-ui="bulk-summary"], [data-ui="bulk-count"]')?.textContent ?? '')
                    }
                  })()`,
                ),
                { visible: true, inToolbar: true, replacesQuery: true, counted: true },
              )
              if (!noArtifacts)
                await capture(
                  cdp,
                  join(productListEvidenceDir, `product-list-selected-${lang}-${viewport.id}.png`),
                )
              await evaluate(cdp, `document.querySelector('[data-ui="kt-row-select"]')?.click()`)
              await waitFor(
                cdp,
                `document.querySelector('[data-ui="list-page-controls"] [data-ui="list-query"]')`,
              )
            }
            if (!noArtifacts)
              await capture(
                cdp,
                join(productListEvidenceDir, `product-list-${state.id}-${lang}-${viewport.id}.png`),
              )
          }
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }

    if (screen.name === 'partner-list') {
      const states = [
        {
          id: 'all',
          query: '',
          pager: true,
          ready: `document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 6`,
        },
        {
          id: 'customers',
          query: '&role=customer',
          pager: false,
          ready: `document.querySelectorAll('[data-ui="kt-row"]').length >= 6`,
        },
        {
          id: 'archived',
          query: '&archived=1',
          pager: true,
          ready: `document.querySelectorAll('[data-ui="kt-row"]').length >= 6`,
        },
        {
          id: 'empty',
          query: '&q=__missing_partner__',
          pager: false,
          ready: `document.querySelector('[data-ui="empty"]')`,
        },
      ]
      const viewports = [
        { id: 'wide', width: 3110, height: 900, mobile: false },
        { id: 'desktop', width: 1440, height: 1000, mobile: false },
        { id: 'mobile', width: 390, height: 844, mobile: true },
      ]
      for (const viewport of viewports) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        })
        for (const theme of ['light', 'dark']) {
          for (const lang of ['vi', 'en']) {
            for (const state of states) {
              await navigate(cdp, `${e2e.baseUrl}/admin/partner/partners?lang=${lang}${state.query}`)
              await waitFor(cdp, state.ready)
              await evaluate(cdp, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
              const layout = await evaluate<{
                pageContained: boolean
                noPageOverflow: boolean
                titleVisible: boolean
                actionVisible: boolean
                controlsVisible: boolean
                searchBounded: boolean
                tailAtRight: boolean
                toolbarFullWidth: boolean
                ordered: boolean
                tableContained: boolean
                legacyRemoved: boolean
                pagerCorrect: boolean
                themeApplied: boolean
              }>(
                cdp,
                `(() => {
                  const page = document.querySelector('[data-ui="list-page"]')
                  const header = document.querySelector('[data-ui="list-page-header"]')
                  const title = document.querySelector('[data-ui="list-page-title"]')
                  const action = document.querySelector('[data-ui="list-page-actions"] [data-ui="action"]')
                  const toolbar = document.querySelector('[data-ui="list-page-toolbar"]')
                  const controls = document.querySelector('[data-ui="list-page-controls"]')
                  const search = document.querySelector('[data-ui="list-page-controls"] [data-ui="search-filter"]')
                  const tail = document.querySelector('[data-ui="list-page-controls"] [data-ui="chrome-tail"]')
                  const body = document.querySelector('[data-ui="list-page-body"]')
                  const table = document.querySelector('[data-ui="kt-scroll"]')
                  const pageBox = page.getBoundingClientRect()
                  const headerBox = header.getBoundingClientRect()
                  const titleBox = title.getBoundingClientRect()
                  const actionBox = action.getBoundingClientRect()
                  const toolbarBox = toolbar.getBoundingClientRect()
                  const controlsBox = controls.getBoundingClientRect()
                  const searchBox = search.getBoundingClientRect()
                  const tailBox = tail.getBoundingClientRect()
                  const bodyBox = body.getBoundingClientRect()
                  const tableBox = table?.getBoundingClientRect()
                  return {
                    pageContained: pageBox.left >= -1 && pageBox.right <= innerWidth + 1,
                    noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
                    titleVisible: titleBox.width > 0 && titleBox.height > 0 &&
                      title.scrollWidth <= title.clientWidth + 1,
                    actionVisible: actionBox.width > 0 && actionBox.height >= 30,
                    controlsVisible: controlsBox.width > 0 && controlsBox.height > 0,
                    searchBounded: searchBox.width <= 801,
                    tailAtRight: ${String(viewport.mobile)} ||
                      (tailBox.right <= toolbarBox.right && toolbarBox.right - tailBox.right <= 12),
                    // The toolbar may bleed to the edge on a phone; its content lines up with the body's.
                    toolbarFullWidth: (() => {
                      const inner = (node) => {
                        const box = node.getBoundingClientRect()
                        const style = getComputedStyle(node)
                        return [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)]
                      }
                      const [toolbarLeft, toolbarRight] = inner(toolbar)
                      const [bodyLeft, bodyRight] = inner(body)
                      return Math.abs(toolbarLeft - bodyLeft) <= 1 && Math.abs(toolbarRight - bodyRight) <= 1
                    })(),
                    ordered: headerBox.bottom <= toolbarBox.top + 1 &&
                      toolbarBox.bottom <= bodyBox.top + 1 &&
                      searchBox.top >= toolbarBox.top - 1 && searchBox.bottom <= toolbarBox.bottom + 1 &&
                      controlsBox.top >= toolbarBox.top - 1 && controlsBox.bottom <= toolbarBox.bottom + 1,
                    tableContained: !tableBox ||
                      (tableBox.left >= bodyBox.left - 1 && tableBox.right <= bodyBox.right + 1),
                    legacyRemoved: !document.querySelector('[data-ui="partner-list-rail"], [data-ui="partner-stat-grid"]'),
                    pagerCorrect: ${String(state.pager)} === Boolean(document.querySelector('[data-ui="pager"]')),
                    themeApplied: getComputedStyle(document.documentElement).colorScheme === ${JSON.stringify(theme)}
                  }
                })()`,
              )
              assert.deepEqual(
                layout,
                {
                  pageContained: true,
                  noPageOverflow: true,
                  titleVisible: true,
                  actionVisible: true,
                  controlsVisible: true,
                  searchBounded: true,
                  tailAtRight: true,
                  toolbarFullWidth: true,
                  ordered: true,
                  tableContained: true,
                  legacyRemoved: true,
                  pagerCorrect: true,
                  themeApplied: true,
                },
                `${viewport.id}/${theme}/${lang}/${state.id}`,
              )
              if (state.id === 'all') {
                // The table selects on the client; the bulk menu shows once it has rendered.
                await evaluate(cdp, `document.querySelector('[data-ui="kt-row-select"]').click()`)
                await waitFor(
                  cdp,
                  `document.querySelector('[data-ui="list-page-actions"] [data-ui="bulk-actions-open"]')?.getBoundingClientRect().width > 0`,
                )
                assert.deepEqual(
                  await evaluate(
                    cdp,
                    `(() => {
                      const create = document.querySelector('[data-ui="list-page-actions"] [data-ui="action"]')
                      const rowSelect = document.querySelector('[data-ui="kt-row-select"]')
                      const more = document.querySelector('[data-ui="list-page-actions"] [data-ui="bulk-actions-open"]')
                      const createBox = create.getBoundingClientRect()
                      const moreBox = more.getBoundingClientRect()
                      return {
                        visible: moreBox.width > 0 && moreBox.height > 0,
                        besideCreate: Math.abs(moreBox.top - createBox.top) <= 1 &&
                          moreBox.left >= createBox.right && moreBox.left - createBox.right <= 16,
                        checked: rowSelect.checked,
                        formLinked: Boolean(
                          document.querySelector('[data-ui="kt-select-persisted"] input[form="partner-directory-bulk"][name^="selected."]'),
                        ),
                        apiLinked: document.querySelector('[data-ui="list-page-actions"] [data-ui="bulk-form"]')
                          ?.getAttribute('action')?.startsWith('/admin/partner/partners/bulk') === true,
                        absentFromControls: !document.querySelector(
                          '[data-ui="list-page-controls"] [data-ui="bulk-form"]'
                        )
                      }
                    })()`,
                  ),
                  {
                    visible: true,
                    besideCreate: true,
                    checked: true,
                    formLinked: true,
                    apiLinked: true,
                    absentFromControls: true,
                  },
                )
                if (!noArtifacts)
                  await capture(
                    cdp,
                    join(partnerListEvidenceDir, `partner-list-selected-${lang}-${theme}-${viewport.id}.png`),
                  )
                await evaluate(cdp, `document.querySelector('[data-ui="kt-row-select"]')?.click()`)
              }
              if (!noArtifacts)
                await capture(
                  cdp,
                  join(
                    partnerListEvidenceDir,
                    `partner-list-${state.id}-${lang}-${theme}-${viewport.id}.png`,
                  ),
                )
            }
          }
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }

    if (screen.name === 'partner-form') {
      const states = [
        {
          id: 'edit',
          path: '/admin/partner/partners/directory-partner-01',
          form: '#partner-identity-form',
          aside: true,
        },
        {
          id: 'create',
          path: '/admin/partner/partners/new',
          form: '#partner-create-form',
          aside: false,
        },
      ]
      const viewports = [
        { id: 'wide', width: 3110, height: 900, mobile: false },
        { id: 'desktop', width: 1440, height: 1000, mobile: false },
        { id: 'compact-desktop', width: 1280, height: 900, mobile: false },
        { id: 'tablet', width: 720, height: 1000, mobile: false },
        { id: 'mobile', width: 390, height: 844, mobile: true },
      ]
      for (const viewport of viewports) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        })
        for (const theme of ['light', 'dark']) {
          for (const lang of ['vi', 'en']) {
            for (const state of states) {
              await navigate(cdp, `${e2e.baseUrl}${state.path}?lang=${lang}`)
              await waitFor(
                cdp,
                `document.querySelector('[data-ui="form-page"]') && document.querySelector(${JSON.stringify(state.form)})${state.aside ? ` && document.querySelector('[data-ui="form-page-aside"] [data-ui="chatter"][data-state="ready"]')` : ''}`,
              )
              await evaluate(cdp, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
              const layout = await evaluate<{
                pageContained: boolean
                noPageOverflow: boolean
                compactHeader: boolean
                compactTitle: boolean
                noHeavyIdentity: boolean
                trailFromFrame: boolean
                actionVisible: boolean
                actionInHeader: boolean
                inlineFields: boolean
                compactControlsWideEnough: boolean
                asideCorrect: boolean
                chatterReady: boolean
                railOneThird: boolean
                railPosition: boolean
                rolesMergedAtTop: boolean
                themeApplied: boolean
              }>(
                cdp,
                `(() => {
                  const page = document.querySelector('[data-ui="form-page"]')
                  const header = page.querySelector('[data-ui="form-page-header"]')
                  const title = page.querySelector('[data-ui="form-page-title"]')
                  const titleRow = page.querySelector('[data-ui="form-page-title-row"]')
                  const action = page.querySelector('[data-ui="form-page-actions"] [data-ui="action"][data-variant="primary"]')
                  const form = document.querySelector(${JSON.stringify(state.form)})
                  const fields = [...form.querySelectorAll('[data-ui="form-field"]:not([data-kind="checkbox"])')]
                  // Labels sit beside their controls from 48rem, above them below it.
                  const narrow = innerWidth < 768
                  const inline = fields.every((field) => {
                    const label = field.querySelector(':scope > [data-ui="form-label"]')
                    const control = field.querySelector(
                      ':scope > [data-ui="form-control"], :scope > [data-ui="form-options"], :scope > ket-island'
                    )
                    if (!label || !control) return false
                    const labelBox = label.getBoundingClientRect()
                    const controlBox = control.getBoundingClientRect()
                    return (narrow ? labelBox.bottom <= controlBox.top + 1 : labelBox.right <= controlBox.left + 1) &&
                      label.scrollWidth <= label.clientWidth + 1 &&
                      controlBox.width > 80
                  })
                  const pageBox = page.getBoundingClientRect()
                  const headerBox = header.getBoundingClientRect()
                  const titleBox = title.getBoundingClientRect()
                  const titleRowBox = titleRow.getBoundingClientRect()
                  const actionBox = action.getBoundingClientRect()
                  const pageLayout = page.querySelector('[data-ui="form-page-layout"]')
                  const pageBody = page.querySelector('[data-ui="form-page-body"]')
                  const aside = page.querySelector('[data-ui="form-page-aside"]')
                  const layoutBox = pageLayout.getBoundingClientRect()
                  const bodyBox = pageBody.getBoundingClientRect()
                  const asideBox = aside?.getBoundingClientRect()
                  const stacked = innerWidth <= 1023
                  return {
                    pageContained: pageBox.left >= -1 && pageBox.right <= innerWidth + 1,
                    noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
                    compactHeader: headerBox.height <= (narrow ? 170 : 120),
                    compactTitle: Number.parseFloat(getComputedStyle(title).fontSize) <= 24,
                    noHeavyIdentity: !page.querySelector(
                      '[data-ui="record-thumbnail"], [data-ui="record-kicker"], [data-ui="form-page-leading"], [data-ui="form-page-eyebrow"]'
                    ),
                    // The location comes from the frame, once, above the title; no separate back link.
                    trailFromFrame: page.querySelectorAll('[data-ui="breadcrumbs"]').length === 1 &&
                      Boolean(page.querySelector('[data-ui="form-page-context"] [data-ui="breadcrumbs"]')) &&
                      !page.querySelector('[data-ui="form-page-back"]'),
                    actionVisible: actionBox.width > 0 && actionBox.height >= 30,
                    // Below 42rem the commands follow the title inside the header instead of sharing its row.
                    actionInHeader: innerWidth <= 672
                      ? actionBox.top >= titleBox.bottom - 1 && actionBox.bottom <= headerBox.bottom + 1
                      : actionBox.top >= titleRowBox.top - 1 && actionBox.bottom <= titleRowBox.bottom + 1,
                    inlineFields: inline,
                    compactControlsWideEnough: ${JSON.stringify(viewport.id)} !== 'compact-desktop' || fields.every((field) => {
                      const control = field.querySelector(
                        ':scope > [data-ui="form-control"], :scope > [data-ui="form-options"], :scope > ket-island'
                      )
                      return control && control.getBoundingClientRect().width >= 175
                    }),
                    asideCorrect: ${String(state.aside)} === Boolean(aside),
                    chatterReady: ${String(!state.aside)} || Boolean(
                      aside?.querySelector('[data-ui="chatter"][data-state="ready"]')
                    ),
                    railOneThird: ${String(!state.aside)} || stacked ||
                      Math.abs(asideBox.width / layoutBox.width - 1 / 3) <= 0.01,
                    railPosition: ${String(!state.aside)} || (stacked
                      ? asideBox.top >= bodyBox.bottom - 1 && Math.abs(asideBox.width - layoutBox.width) <= 1
                      : asideBox.left >= bodyBox.right - 1),
                    rolesMergedAtTop: (() => {
                      const fields = [...form.querySelectorAll('[data-ui="form-field"]')]
                      const roleGroup = fields[0]
                      const roleNames = [...roleGroup.querySelectorAll('input[type="checkbox"]')]
                        .map((input) => input.getAttribute('name'))
                      const nameField = fields[1]?.querySelector('input, select, textarea')?.getAttribute('name')
                      return roleGroup.getAttribute('data-kind') === 'checkbox-group' &&
                        JSON.stringify(roleNames) === JSON.stringify(['customer', 'supplier', 'employee']) &&
                        nameField === 'name' &&
                        !page.querySelector('form[action*="/roles"]')
                    })(),
                    themeApplied: getComputedStyle(document.documentElement).colorScheme === ${JSON.stringify(theme)}
                  }
                })()`,
              )
              assert.deepEqual(
                layout,
                {
                  pageContained: true,
                  noPageOverflow: true,
                  compactHeader: true,
                  compactTitle: true,
                  noHeavyIdentity: true,
                  trailFromFrame: true,
                  actionVisible: true,
                  actionInHeader: true,
                  inlineFields: true,
                  compactControlsWideEnough: true,
                  asideCorrect: true,
                  chatterReady: true,
                  railOneThird: true,
                  railPosition: true,
                  rolesMergedAtTop: true,
                  themeApplied: true,
                },
                `${viewport.id}/${theme}/${lang}/${state.id}`,
              )
              if (!noArtifacts)
                await capture(
                  cdp,
                  join(
                    partnerFormEvidenceDir,
                    `partner-form-${state.id}-${lang}-${theme}-${viewport.id}.png`,
                  ),
                )
            }
          }
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }

    if (screen.name === 'my-activities') {
      const layout = await evaluate<{
        clusters: number
        aligned: boolean
        contained: boolean
        uniqueIds: boolean
        variants: string[][]
      }>(
        cdp,
        `(() => {
          const clusters = [...document.querySelectorAll('[data-ui="form-cluster"]')]
          const ids = [...document.querySelectorAll('[data-ui="form-cluster"] input[id]')]
            .map((input) => input.id)
          return {
            clusters: clusters.length,
            aligned: clusters.every((cluster) => {
              const controls = [...cluster.querySelectorAll('input:not([type="hidden"]), button')]
              const bottoms = controls.map((control) => control.getBoundingClientRect().bottom)
              return Math.max(...bottoms) - Math.min(...bottoms) <= 1
            }),
            contained: clusters.every((cluster) => {
              const bounds = cluster.getBoundingClientRect()
              return [...cluster.querySelectorAll('input:not([type="hidden"]), button')]
                .every((control) => {
                  const box = control.getBoundingClientRect()
                  return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
                })
            }),
            uniqueIds: new Set(ids).size === ids.length,
            variants: clusters.map((cluster) =>
              [...cluster.querySelectorAll('[data-ui="action"]')]
                .map((action) => action.dataset.variant)
            )
          }
        })()`,
      )
      // One cluster per open activity: complete, reschedule and cancel in one row.
      assert.ok(layout.clusters >= 2, `${layout.clusters} activity clusters`)
      assert.equal(layout.aligned, true)
      assert.equal(layout.contained, true)
      assert.equal(layout.uniqueIds, true)
      assert.deepEqual(
        layout.variants,
        layout.variants.map(() => ['primary', 'secondary', 'destructive']),
      )

      await waitFor(
        cdp,
        `document.querySelector('[data-ui="mail-indicator"]') && document.querySelector('[data-ui="activity-indicator"]')`,
      )
      const footer = await evaluate<{
        ordered: boolean
        aligned: boolean
        accountMenuVisible: boolean
        accountMenuContained: boolean
        signoutPost: boolean
      }>(
        cdp,
        `(() => {
          const mail = document.querySelector('[data-ui="mail-indicator"]')
          const activity = document.querySelector('[data-ui="activity-indicator"]')
          const viewer = document.querySelector('[data-ui="viewer"]')
          viewer.open = true
          const mailBox = mail.getBoundingClientRect()
          const activityBox = activity.getBoundingClientRect()
          const menuBox = viewer.querySelector('[data-ui="viewer-menu"]').getBoundingClientRect()
          const result = {
            ordered: mailBox.left < activityBox.left,
            aligned: Math.abs(mailBox.top - activityBox.top) <= 1 &&
              Math.abs(mailBox.height - activityBox.height) <= 1,
            accountMenuVisible: menuBox.width > 0 && menuBox.height > 0,
            accountMenuContained: menuBox.left >= 0 && menuBox.right <= innerWidth,
            signoutPost: viewer.querySelector('[data-ui="signout"]')?.method === 'post'
          }
          viewer.open = false
          return result
        })()`,
      )
      assert.deepEqual(footer, {
        ordered: true,
        aligned: true,
        accountMenuVisible: true,
        accountMenuContained: true,
        signoutPost: true,
      })
    }

    if (screen.name === 'product-chatter') {
      // The record keeps its reading width and the rail its own track; a wider screen
      // leaves the rest empty instead of stretching either.
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, screen.ready)
      assert.deepEqual(
        await evaluate<Record<string, boolean>>(
          cdp,
          `(() => {
            const layout = document.querySelector('[data-ui="record-page-layout"]')
            const body = document.querySelector('[data-ui="record-page-body"]').getBoundingClientRect()
            const aside = document.querySelector('[data-ui="record-page-aside"]').getBoundingClientRect()
            const rail = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kv-right-rail-width')) *
              Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
            const [bodyTrack, railTrack] = getComputedStyle(layout).gridTemplateColumns.split(' ').map(Number.parseFloat)
            return {
              railTrack: Math.abs(railTrack - rail) <= 1,
              bodyCapped: bodyTrack + railTrack < layout.getBoundingClientRect().width - 1,
              asideBeside: aside.left >= body.right - 1,
              collaborationInBody: ['[data-ui="chatter"]', '[data-ui="activity-record"]']
                .every((hook) => document.querySelector(hook)?.closest('[data-ui="record-page-body"]')),
              noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
            }
          })()`,
        ),
        {
          railTrack: true,
          bodyCapped: true,
          asideBeside: true,
          collaborationInBody: true,
          noHorizontalOverflow: true,
        },
      )
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, screen.ready)
      assert.deepEqual(
        await evaluate<Record<string, boolean | number>>(
          cdp,
          `(() => {
            const form = document.querySelector('[data-ui="record-page-body"] form#product-record')
            return {
              saves: document.querySelectorAll('button[type="submit"][form="product-record"][value="save"], #product-record button[type="submit"][value="save"]').length,
              businessUse: ['saleOk', 'purchaseOk', 'isStorable'].every((name) => form?.querySelector('input[type="checkbox"][name="' + name + '"]')),
              fieldsAtLeast28: [...form.querySelectorAll('[data-ui="field"]')].every((field) => field.getBoundingClientRect().height >= 28),
              noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
            }
          })()`,
        ),
        { saves: 1, businessUse: true, fieldsAtLeast28: true, noHorizontalOverflow: true },
      )
      // Saving reads the record again in place: the collaboration islands and the shell stay.
      await evaluate(
        cdp,
        `(() => {
          globalThis.__productSaveNodes = {
            chatter: document.querySelector('[data-island="mail.chatter"]'),
            activity: document.querySelector('[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('button[type="submit"][form="product-record"][value="save"], #product-record button[type="submit"][value="save"]').click()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-page"] [data-ui="notice"][data-tone="positive"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: Boolean(globalThis.__productSaveNodes.chatter) &&
              globalThis.__productSaveNodes.chatter === document.querySelector('[data-island="mail.chatter"]'),
            activity: Boolean(globalThis.__productSaveNodes.activity) &&
              globalThis.__productSaveNodes.activity === document.querySelector('[data-island="activity.record"]'),
            sidebar: Boolean(globalThis.__productSaveNodes.sidebar) &&
              globalThis.__productSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            formReady: Boolean(document.querySelector('form#product-record:not([aria-busy="true"])'))
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, formReady: true },
      )

      await evaluate(cdp, `document.querySelector('[data-ui="chatter-kind"][data-kind="comment"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="chatter-composer"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="chatter-composer"]')
          const body = form.querySelector('[name="body"]')
          body.value = '<img src=x onerror=globalThis.__xss=1> Browser E2E'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Browser E2E')`)
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('[data-ui="chatter-message-body"] img'))`),
        false,
      )
      assert.equal(await evaluate(cdp, `globalThis.__xss === 1`), false)

      await evaluate(cdp, `document.querySelector('[data-ui="activity-schedule-trigger"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="activity-schedule"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="activity-schedule"]')
          form.querySelector('[name="typeId"]').value = 'activity-todo'
          form.querySelector('[name="summary"]').value = 'Hoạt động từ Browser E2E'
          form.querySelector('[name="note"]').value = 'Được tạo qua island thật.'
          form.querySelector('[name="dueDate"]').value = '2026-08-20'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E'))`,
      )
      await evaluate(
        cdp,
        `(() => {
          const item = [...document.querySelectorAll('[data-ui="activity-item"]')]
            .find((entry) => entry.textContent.includes('Hoạt động từ Browser E2E'))
          item.querySelector('[data-ui="activity-action-trigger"][data-action="complete"]').click()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E') && item.querySelector('[data-ui="activity-complete"]'))`,
      )
      await evaluate(
        cdp,
        `(() => {
          const item = [...document.querySelectorAll('[data-ui="activity-item"]')]
            .find((entry) => entry.textContent.includes('Hoạt động từ Browser E2E'))
          const form = item.querySelector('[data-ui="activity-complete"]')
          form.querySelector('[name="feedback"]').value = 'Đã kiểm chứng trên Chrome headless.'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `[...document.querySelectorAll('[data-ui="activity-item"][data-state="done"]')].some((item) => item.textContent.includes('Hoạt động từ Browser E2E'))`,
      )
    }
    if (screen.name === 'product-variant-chatter') {
      const generalPadding = await evaluate(
        cdp,
        `getComputedStyle(document.querySelector('[data-ui="form-page-body"]')).padding`,
      )
      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/product/templates/tpl-collab/variants/variant-collab?tab=media&lang=vi`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="tab"][data-active="true"]')?.textContent.includes('Hình ảnh')`,
      )
      assert.equal(
        await evaluate(cdp, `getComputedStyle(document.querySelector('[data-ui="form-page-body"]')).padding`),
        generalPadding,
      )
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, `document.querySelector('form[data-scope="product-variant"]')`)
      await waitFor(
        cdp,
        `document.querySelector('ket-island[data-island="product.editor"] [data-record-save-status]')?.hidden === true`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            editorIdle: document.querySelector('ket-island[data-island="product.editor"] [data-record-save-status]')?.hidden === true,
            controllerCollapsed: document.querySelector('[data-ui="form-page-controller"]').getBoundingClientRect().height === 0,
            tabs: document.querySelectorAll('[data-ui="form-page-navigation"] [data-ui="tab"]').length,
            gridRowsAtLeast28: Array.from(document.querySelectorAll('[data-ui="form-page-body"] [data-ui="form-grid"] > [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="form-page-body"]').getBoundingClientRect().width,
            noHeavyIdentity: !document.querySelector('[data-ui="record-thumbnail"], [data-ui="record-kicker"], [data-ui="record-facts"]'),
            trailFromFrame: document.querySelectorAll('[data-ui="form-page-context"] [data-ui="breadcrumbs"]').length === 1,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          editorIdle: true,
          controllerCollapsed: true,
          tabs: 2,
          gridRowsAtLeast28: true,
          collaborationNarrower: true,
          noHeavyIdentity: true,
          trailFromFrame: true,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          globalThis.__variantSaveNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('form[data-scope="product-variant"]').requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-controller"] [data-ui="notice"][data-tone="positive"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__variantSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__variantSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__variantSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            formReady: Boolean(document.querySelector('form[data-scope="product-variant"]:not([aria-busy="true"])')),
            editorVisible: document.querySelector('ket-island[data-island="product.editor"] [data-record-save-status]')?.hidden === false
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, formReady: true, editorVisible: true },
      )
    }
    if (screen.name === 'product-attributes') {
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'product.attribute')),
          rows: await evaluate(cdp, `document.querySelectorAll('[data-ui="kt-row"]').length`),
        },
        { recordModal: true, fieldsAtLeast28: true, chatter: false, horizontalOverflow: false, rows: 3 },
      )
      await submitRecordForm(cdp, 'product.attribute', { name: 'Hoàn thiện', createVariant: 'no_variant' })
      // The modal closes and the list, read again, carries the new attribute.
      await waitFor(
        cdp,
        `!new URLSearchParams(location.search).has('record') && [...document.querySelectorAll('[data-ui="kt-row"]')].some((row) => row.textContent.includes('Hoàn thiện'))`,
      )
      assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-ui="kt-row"]').length`), 4)
    }
    if (screen.name === 'product-favorite') {
      // Saving a view opens over the list it saves, inside the content slot, and returns to it.
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const modal = document.querySelector('[data-route-modal="true"]')
            const form = modal.querySelector('#product-favorite-create-form')
            const sheet = modal.querySelector('[data-ui="modal-sheet"]').getBoundingClientRect()
            return {
              inContent: Boolean(modal.closest('[data-ket-slot="backend.content"]')),
              visible: sheet.width > 0 && sheet.height > 0,
              fields: form.querySelectorAll('[data-ui="form-field"]').length,
              returnTo: form.querySelector('[name="returnTo"]')?.value,
              closePath: modal.querySelector('[data-ui="modal-close"]')?.getAttribute('href'),
              cancelPath: modal.querySelector('a[data-ui="action"]')?.getAttribute('href'),
              chatter: Boolean(document.querySelector('[data-island="mail.chatter"]')),
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        {
          inContent: true,
          visible: true,
          fields: 2,
          returnTo: '/admin/product/templates?q=OPS&lang=vi',
          closePath: '/admin/product/templates?q=OPS&lang=vi',
          cancelPath: '/admin/product/templates?q=OPS&lang=vi',
          chatter: false,
          horizontalOverflow: false,
        },
      )
    }
    if (screen.name === 'product-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const form = document.querySelector('[data-ui="record-page-body"] form#product-record')
            return {
              noRail: !document.querySelector('[data-ui="record-page-aside"]'),
              type: Boolean(form.querySelector('[name="type"]')),
              businessUse: ['saleOk', 'purchaseOk', 'isStorable'].every((name) => form.querySelector('input[type="checkbox"][name="' + name + '"]')),
              creates: document.querySelectorAll('button[type="submit"][form="product-record"][value="create"], #product-record button[type="submit"][value="create"]').length,
              fieldsAtLeast28: [...form.querySelectorAll('[data-ui="field"]')].every((field) => field.getBoundingClientRect().height >= 28),
              chatter: Boolean(document.querySelector('[data-island="mail.chatter"]')),
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        {
          noRail: true,
          type: true,
          businessUse: true,
          creates: 1,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('form#product-record')
          for (const [name, value] of Object.entries({
            name: 'Sản phẩm Browser E2E',
            uomId: 'unit',
            listPrice: '320000',
            description: 'Được tạo bằng trình duyệt headless.',
          })) {
            const control = form.querySelector('[name="' + name + '"]')
            control.value = value
            control.dispatchEvent(new Event('input', { bubbles: true }))
            control.dispatchEvent(new Event('change', { bubbles: true }))
          }
          document.querySelector('button[type="submit"][form="product-record"][value="create"], #product-record button[type="submit"][value="create"]').click()
          return true
        })()`,
      )
      // The new product opens as its own page, with its collaboration.
      await waitFor(
        cdp,
        `!location.pathname.endsWith('/new') && document.querySelector('[data-ui="record-page-title"]')?.textContent.includes('Sản phẩm Browser E2E') && document.querySelector('[data-ui="chatter"][data-state="ready"]')`,
      )
    }
    if (screen.name === 'inventory-adjustment') {
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'stock.count')),
          ...(await evaluate<Record<string, boolean>>(
            cdp,
            `({
              listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
              productSelector: ${recordForm('stock.count')}.querySelector('[name="productId"]')?.tagName === 'SELECT',
              stockRowsAtLeastOne: document.querySelectorAll('[data-ui="kt-row"]').length >= 1
            })`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          listPage: true,
          productSelector: true,
          stockRowsAtLeastOne: true,
        },
      )
      await submitRecordForm(
        cdp,
        'stock.count',
        {
          productId: 'variant-collab',
          locationId: 'wh:stock',
          countedQuantity: '21',
          inventoryLocationId: 'inventory-adjustment',
        },
        'preview',
      )
      await waitFor(
        cdp,
        `${recordForm('stock.count')}?.querySelector('button[name="__command"][value="apply"]')`,
      )
      await submitRecordForm(cdp, 'stock.count', {}, 'apply')
      await waitFor(
        cdp,
        `!new URLSearchParams(location.search).has('record') && document.querySelector('[data-ui="ket-table"]')?.textContent.includes('21')`,
      )
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))`),
        false,
      )
    }
    if (screen.name === 'transfer-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            source: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Tồn kho'),
            destination: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Khách hàng'),
            createLink: Boolean(document.querySelector('[data-ui="list-page-actions"] a[href*="record=stock.transfer%3Anew"]')),
            inlineCreate: Boolean(document.querySelector('#transfer-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          source: true,
          destination: true,
          createLink: true,
          inlineCreate: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-list-vi-desktop.png'))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/transfers?lang=vi`)
      await waitFor(cdp, `document.querySelector('[data-ui="list-page"]')`)
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-list-vi-mobile.png'))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'transfer-create') {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/transfers/new?lang=vi`)
      await waitFor(cdp, `document.querySelector('#transfer-create-form')`)
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const fields = [...document.querySelectorAll('#transfer-create-form [data-ui="form-field"]')]
            return {
              formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
              fields: fields.length,
              controlsWiderThanLabels: fields.every((field) => {
                const label = field.querySelector(':scope > [data-ui="form-label"]')
                const control = field.querySelector(':scope > [data-ui="form-control"]')
                return !label || !control || control.getBoundingClientRect().width > label.getBoundingClientRect().width
              }),
              chatter: Boolean(document.querySelector('[data-ui="chatter"]')),
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        {
          formPage: true,
          fields: 3,
          controlsWiderThanLabels: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-create-vi-desktop.png'))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/transfers/new?lang=vi`)
      await waitFor(cdp, `document.querySelector('#transfer-create-form')`)
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-create-vi-mobile.png'))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/transfers/new?lang=vi`)
      await waitFor(cdp, `document.querySelector('#transfer-create-form')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#transfer-create-form')
          form.querySelector('[name="name"]').value = 'TP/INT/BROWSER'
          form.querySelector('[name="pickingTypeId"]').value = 'wh:internal'
          form.querySelector('[name="scheduledDate"]').value = '2026-08-22T09:00'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-title"]')?.textContent.includes('TP/INT/BROWSER') && document.querySelector('[data-ui="chatter"][data-state="ready"]')`,
      )
    }
    if (screen.name === 'warehouse-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=stock.warehouse%3Anew"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#warehouse-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          createHref: '/admin/stock/warehouses?lang=vi&record=stock.warehouse%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
    }
    if (screen.name === 'warehouse-create') {
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'stock.warehouse')),
          ...(await evaluate<Record<string, number | boolean>>(
            cdp,
            `({
              receiptSteps: ${recordForm('stock.warehouse')}.querySelectorAll('[name="receptionSteps"] option').length,
              deliverySteps: ${recordForm('stock.warehouse')}.querySelectorAll('[name="deliverySteps"] option').length
            })`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          receiptSteps: 3,
          deliverySteps: 3,
        },
      )
      await submitRecordForm(cdp, 'stock.warehouse', {
        name: 'Kho Browser',
        code: 'BRW',
        receptionSteps: 'three_steps',
        deliverySteps: 'pick_pack_ship',
      })
      await waitFor(cdp, openedRecord('stock.warehouse'))
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Kho Browser') && document.querySelector('[data-ui="ket-table"]')?.textContent.includes('BRW')`,
      )
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))`),
        false,
      )
    }
    if (screen.name === 'location-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            completeName: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Kho Thành Phẩm / Tồn kho'),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=stock.location%3Anew"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#location-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          completeName: true,
          createHref: '/admin/stock/locations?lang=vi&record=stock.location%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
    }
    if (screen.name === 'location-create') {
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'stock.location')),
          ...(await evaluate<Record<string, number | boolean>>(
            cdp,
            `({
              parentOptions: ${recordForm('stock.location')}.querySelectorAll('[name="parentId"] option').length > 1,
              usageOptions: ${recordForm('stock.location')}.querySelectorAll('[name="usage"] option').length
            })`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          parentOptions: true,
          usageOptions: 7,
        },
      )
      await submitRecordForm(cdp, 'stock.location', {
        name: 'Kệ A-01',
        usage: 'internal',
        parentId: 'wh:stock',
        warehouseId: 'wh',
      })
      await waitFor(cdp, openedRecord('stock.location'))
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Kho Thành Phẩm / Tồn kho / Kệ A-01')`,
      )
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))`),
        false,
      )
    }
    if (screen.name === 'operation-type-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            completeLocations: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Kho Thành Phẩm / Tồn kho'),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=stock.pickingType%3Anew"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#picking-type-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          completeLocations: true,
          createHref: '/admin/stock/picking-types?lang=vi&record=stock.pickingType%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
    }
    if (screen.name === 'operation-type-create') {
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'stock.pickingType')),
          ...(await evaluate<Record<string, number | boolean>>(
            cdp,
            `({
              codeOptions: ${recordForm('stock.pickingType')}.querySelectorAll('[name="code"] option').length,
              sourceOptions: ${recordForm('stock.pickingType')}.querySelectorAll('[name="defaultLocationSrcId"] option').length > 1
            })`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          codeOptions: 3,
          sourceOptions: true,
        },
      )
      await submitRecordForm(cdp, 'stock.pickingType', {
        name: 'Điều chuyển Browser',
        code: 'internal',
        warehouseId: 'wh',
        defaultLocationSrcId: 'wh:stock',
        defaultLocationDestId: 'wh:output',
        createBackorder: 'ask',
      })
      await waitFor(cdp, openedRecord('stock.pickingType'))
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Điều chuyển Browser')`,
      )
      assert.equal(
        await evaluate(cdp, `Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))`),
        false,
      )
    }
    if (screen.name === 'route-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            detailLink: Boolean(document.querySelector('[data-ui="ket-table"] a[href*="record=stock.route%3A"]')),
            ruleCount: [...document.querySelectorAll('[data-ui="kt-row"] [data-col="ruleCount"]')].some((cell) => /[1-9]/.test(cell.textContent ?? '')),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=stock.route%3Anew"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#stock-route-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          detailLink: true,
          ruleCount: true,
          createHref: '/admin/stock/routes?lang=vi&record=stock.route%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(routeEvidenceDir, 'route-list-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Inventory routes')`), true)
      if (!noArtifacts) await capture(cdp, join(routeEvidenceDir, 'route-list-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            listVisible: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.getBoundingClientRect().height > 0
          })`,
        ),
        { horizontalOverflow: false, listVisible: true },
      )
      if (!noArtifacts) await capture(cdp, join(routeEvidenceDir, 'route-list-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      if (!noArtifacts) await capture(cdp, join(routeEvidenceDir, 'route-list-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'route-create') {
      assert.deepEqual(await createModalLayout(cdp, 'stock.route'), {
        recordModal: true,
        fieldsAtLeast28: true,
        chatter: false,
        horizontalOverflow: false,
      })
      await submitRecordForm(cdp, 'stock.route', { name: 'Tuyến Browser hai bước', sequence: '15' })
      await waitFor(cdp, openedRecord('stock.route'))
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Tuyến Browser hai bước')`,
      )
    }
    if (screen.name === 'route-detail') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            routeForm: Boolean(document.querySelector('#stock-route-detail-form[data-scope="stock-route"]')),
            ruleForm: Boolean(document.querySelector('#stock-route-rule-form[data-scope="stock-route-rule"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            localizedRoute: document.body.textContent.includes('Nhận hàng trực tiếp'),
            localizedRule: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Cung ứng theo nhu cầu'),
            rawSelectionCode: /one_step|make_to_stock/.test(document.querySelector('[data-ui="form-page"]')?.textContent ?? ''),
            formRowsAtLeast28: Array.from(document.querySelectorAll('#stock-route-detail-form [data-ui="form-field"], #stock-route-rule-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          routeForm: true,
          ruleForm: true,
          rowsAtLeastOne: true,
          localizedRoute: true,
          localizedRule: true,
          rawSelectionCode: false,
          formRowsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#stock-route-detail-form')
          form.noValidate = true
          form.querySelector('[name="name"]').value = ''
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `location.search.includes('invalid=route')`)
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            error: Boolean(document.querySelector('#stock-route-detail-form [data-ui="form-errors"][role="alert"]')),
            unrelatedError: Boolean(document.querySelector('#stock-route-rule-form [data-ui="form-errors"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))
          })`,
        ),
        { error: true, unrelatedError: false, chatter: false },
      )
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes/wh:receipt-route?lang=vi`)
      await waitFor(cdp, `document.querySelector('#stock-route-rule-form')`)
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(routeDetailEvidenceDir, 'route-detail-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes/wh:receipt-route?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('#stock-route-rule-form') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Configured rules')`), true)
      await evaluate(cdp, `scrollTo(0, 0)`)
      assert.equal(await evaluate(cdp, `scrollX`), 0)
      if (!noArtifacts) await capture(cdp, join(routeDetailEvidenceDir, 'route-detail-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes/wh:receipt-route?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('#stock-route-rule-form') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            routeFormVisible: document.querySelector('#stock-route-detail-form')?.getBoundingClientRect().height > 0,
            ruleFormVisible: document.querySelector('#stock-route-rule-form')?.getBoundingClientRect().height > 0,
            formRowsAtLeast28: Array.from(document.querySelectorAll('#stock-route-detail-form [data-ui="form-field"], #stock-route-rule-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28)
          })`,
        ),
        {
          horizontalOverflow: false,
          routeFormVisible: true,
          ruleFormVisible: true,
          formRowsAtLeast28: true,
        },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(routeDetailEvidenceDir, 'route-detail-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/routes/wh:receipt-route?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('#stock-route-rule-form') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(routeDetailEvidenceDir, 'route-detail-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'replenishment') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            forecast: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Dự báo'),
            proposal: Boolean(document.querySelector('[data-ui="table"] [data-ui="badge"][data-tone="warning"], [data-ui="ket-table"] [data-ui="badge"][data-tone="warning"]')),
            runAction: Boolean(document.querySelector('[data-ui="table"] form[action*="/admin/stock/replenishment/"], [data-ui="ket-table"] form[action*="/admin/stock/replenishment/"]')),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=stock.replenishment%3Anew"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#replenishment-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          forecast: true,
          proposal: true,
          runAction: true,
          createHref: '/admin/stock/replenishment?lang=vi&record=stock.replenishment%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
    }
    if (screen.name === 'replenishment-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            productSelector: document.querySelector('#replenishment-create-form [name="productId"]')?.tagName === 'SELECT',
            storableProduct: document.querySelector('#replenishment-create-form [name="productId"]')?.textContent.includes('Áo khoác vận hành · OPS-JACKET'),
            fields: document.querySelectorAll('#replenishment-create-form [data-ui="form-field"]').length,
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          productSelector: true,
          storableProduct: true,
          fields: 8,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#replenishment-create-form')
          form.noValidate = true
          form.querySelector('[name="productId"]').value = 'variant-collab'
          form.querySelector('[name="warehouseId"]').value = 'wh'
          form.querySelector('[name="locationId"]').value = 'wh:output'
          form.querySelector('[name="trigger"]').value = 'auto'
          form.querySelector('[name="minQuantity"]').value = '10'
          form.querySelector('[name="maxQuantity"]').value = '5'
          form.querySelector('[name="replenishmentUomId"]').value = 'unit'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `location.search.includes('invalid=1')`)
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            error: Boolean(document.querySelector('#replenishment-create-form [data-ui="form-errors"][role="alert"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))
          })`,
        ),
        { error: true, chatter: false },
      )

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/replenishment?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'vi'`,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(replenishmentEvidenceDir, 'replenishment-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/replenishment?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Replenishment')`), true)
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(replenishmentEvidenceDir, 'replenishment-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/replenishment?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            listVisible: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.getBoundingClientRect().height > 0
          })`,
        ),
        { horizontalOverflow: false, listVisible: true },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(replenishmentEvidenceDir, 'replenishment-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/replenishment?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(replenishmentEvidenceDir, 'replenishment-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'forecast') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            dashboardPage: Boolean(document.querySelector('[data-ui="dashboard-page"]')),
            filterForm: Boolean(document.querySelector('#forecast-filter-form[data-scope="stock-forecast"]')),
            selectedProduct: document.querySelector('#forecast-filter-form [name="productId"]')?.value === 'variant-collab',
            selectedLocation: document.querySelector('#forecast-filter-form [name="locationId"]')?.value === 'wh:stock',
            locationPrecedence: document.querySelector('[data-ui="dashboard-page"]')?.textContent.includes('Vị trí: Tồn kho'),
            result: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length === 1,
            formula: document.body.textContent.includes('Tồn thực tế + sắp nhận − sắp xuất = tồn dự báo'),
            formRowsAtLeast28: Array.from(document.querySelectorAll('#forecast-filter-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          dashboardPage: true,
          filterForm: true,
          selectedProduct: true,
          selectedLocation: true,
          locationPrecedence: true,
          result: true,
          formula: true,
          formRowsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/forecast?lang=vi`)
      await waitFor(cdp, `document.querySelector('#forecast-filter-form')`)
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            empty: document.body.textContent.includes('Chưa chọn sản phẩm'),
            table: Boolean(document.querySelector('[data-ui="table"], [data-ui="ket-table"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))
          })`,
        ),
        { empty: true, table: false, chatter: false },
      )

      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/stock/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=vi`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'vi'`,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(forecastEvidenceDir, 'forecast-vi-desktop.png'))

      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/stock/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=en`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Availability')`), true)
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(forecastEvidenceDir, 'forecast-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/stock/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=vi`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            formRowsAtLeast28: Array.from(document.querySelectorAll('#forecast-filter-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            resultVisible: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.getBoundingClientRect().height > 0
          })`,
        ),
        { horizontalOverflow: false, formRowsAtLeast28: true, resultVisible: true },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(forecastEvidenceDir, 'forecast-vi-mobile.png'))

      await navigate(
        cdp,
        `${e2e.baseUrl}/admin/stock/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=en`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(forecastEvidenceDir, 'forecast-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'quotation-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=sale.order%3Anew"]')?.getAttribute('href'),
            inlineForm: Boolean(document.querySelector('#quotation-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          createHref: '/admin/sales/quotations?lang=vi&record=sale.order%3Anew',
          inlineForm: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(quotationEvidenceDir, 'quotations-list-vi-desktop.png'))
    }
    if (screen.name === 'quotation-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            fields: document.querySelectorAll('#quotation-create-form [data-ui="form-field"]').length,
            customerBlank: document.querySelector('#quotation-create-form [name="partnerId"]')?.value === '',
            warehouseBlank: document.querySelector('#quotation-create-form [name="warehouseId"]')?.value === '',
            cancelHref: document.querySelector('[data-ui="form-page-actions"] a')?.getAttribute('href'),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          fields: 7,
          customerBlank: true,
          warehouseBlank: true,
          cancelHref: '/admin/sales/quotations?state=draft&lang=vi',
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#quotation-create-form')
          form.noValidate = true
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `location.pathname === '/admin/sales/quotations/new' && location.search.includes('invalid=1')`,
      )
      assert.equal(
        await evaluate(
          cdp,
          `Boolean(document.querySelector('#quotation-create-form [data-ui="form-errors"]'))`,
        ),
        true,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts)
        await capture(cdp, join(quotationCreateEvidenceDir, 'quotation-create-vi-desktop.png'))
    }
    if (screen.name === 'vendor-pricelist-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            methodForm: Boolean(document.querySelector('form [name="action"][value="method"]')),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="record=purchase.vendorPrice%3Anew"]')?.getAttribute('href'),
            inlineCreate: Boolean(document.querySelector('#purchase-vendor-pricelist-create')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          methodForm: true,
          createHref: '/admin/purchase/vendor-pricelists?lang=vi&record=purchase.vendorPrice%3Anew',
          inlineCreate: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(vendorPricelistEvidenceDir, 'vendor-pricelists-list.png'))
    }
    if (screen.name === 'vendor-pricelist-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            fields: document.querySelectorAll('#purchase-vendor-pricelist-create [data-ui="form-field"]').length,
            cancelHref: document.querySelector('[data-ui="form-page-actions"] a')?.getAttribute('href'),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          fields: 13,
          cancelHref: '/admin/purchase/vendor-pricelists?lang=vi',
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(vendorPricelistEvidenceDir, 'vendor-pricelist-create.png'))
    }
    if (screen.name === 'crm-pipeline') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            boardPage: Boolean(document.querySelector('[data-ui="board-page"]')),
            board: Boolean(document.querySelector('[data-crm-board][role="region"]')),
            summary: Boolean(document.querySelector('[data-ui="board-page-meta"]')?.textContent.trim()),
            search: Boolean(document.querySelector('[data-ui="board-page"] form[role="search"]')),
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          boardPage: true,
          board: true,
          summary: true,
          search: true,
          listPage: false,
          formPage: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(crmPipelineEvidenceDir, 'crm-pipeline.png'))
    }
    if (screen.name === 'crm-cases-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            createHref: document.querySelector('[data-ui="list-page"] a[href*="/admin/crm/cases/new"]')?.getAttribute('href') ?? '',
            inlineForm: Boolean(document.querySelector('#crm-case-create-form')),
            columns: document.querySelectorAll('[data-ui="table"] [data-ui="column-header"]').length,
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          createHref: '/admin/crm/cases/new?lang=vi',
          inlineForm: false,
          columns: 0,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(crmCasesEvidenceDir, 'crm-cases-list.png'))
    }
    if (screen.name === 'crm-case-create') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const form = document.querySelector('[data-ui="record-page"] form#sales-create')
            return {
              recordPage: Boolean(form),
              fields: ['name', 'kind', 'partnerId', 'contactName', 'phone', 'email', 'source', 'teamId'].every(
                (name) => form?.querySelector('[name="' + name + '"]'),
              ),
              kind: form?.querySelector('[name="kind"]')?.value,
              context: form?.querySelector('[name="context"]')?.value,
              chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        {
          recordPage: true,
          fields: true,
          kind: 'lead',
          context: 'screen=lead-new&kind=lead&lang=vi',
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(crmCasesEvidenceDir, 'crm-case-create.png'))
    }
    if (screen.name === 'sales-overview') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            dashboardPage: Boolean(document.querySelector('[data-ui="dashboard-page"]')),
            metrics: document.querySelectorAll('[data-ui="metric"]').length,
            createHref: document.querySelector('a[href*="record=sale.order%3Anew"]')?.getAttribute('href'),
            recentRowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          dashboardPage: true,
          metrics: 4,
          createHref: '/admin/sales/quotations?lang=vi&record=sale.order%3Anew',
          recentRowsAtLeastOne: true,
          listPage: false,
          formPage: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(salesOverviewEvidenceDir, 'sales-overview.png'))
    }
    if (screen.name === 'purchase-overview') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            dashboardPage: Boolean(document.querySelector('[data-ui="dashboard-page"]')),
            metrics: document.querySelectorAll('[data-ui="metric"]').length,
            rfqHref: document.querySelector('a[href*="record=purchase.order%3Anew"]')?.getAttribute('href'),
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          dashboardPage: true,
          metrics: 5,
          rfqHref: '/admin/purchase/rfqs?lang=vi&record=purchase.order%3Anew',
          listPage: false,
          formPage: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(purchaseOverviewEvidenceDir, 'purchase-overview.png'))
    }
    if (screen.name === 'sale-order-detail') {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await navigate(cdp, `${e2e.baseUrl}${screen.path}`)
      await waitFor(cdp, screen.ready, 15_000)
      await waitFor(
        cdp,
        `document.querySelector('ket-island[data-island="sale.editor"] [data-record-save-status]')?.hidden === true`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const layout = document.querySelector('[data-ui="record-page-layout"]')
            const body = document.querySelector('[data-ui="record-page-body"]')
            const aside = document.querySelector('[data-ui="record-page-aside"]')
            const rail = getComputedStyle(layout).gridTemplateColumns.split(' ').at(-1)
            return {
              recordPage: Boolean(layout),
              chatter: Boolean(document.querySelector('[data-ui="chatter"][data-state="ready"]')),
              activity: Boolean(document.querySelector('[data-ui="activity-record"][data-state="ready"]')),
              lineRows: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length,
              productSelector: document.querySelector('#sale-order-line-form [name="productId"]')?.tagName === 'SELECT',
              formRowsAtLeast28: Array.from(document.querySelectorAll('#sale-order-line-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
              editorIdle: document.querySelector('ket-island[data-island="sale.editor"] [data-record-save-status]')?.hidden === true,
              asideRailWidth:
                parseFloat(rail) ===
                parseFloat(getComputedStyle(layout).getPropertyValue('--kv-right-rail-width')) *
                  parseFloat(getComputedStyle(document.documentElement).fontSize),
              asideBesideBody: aside.getBoundingClientRect().left >= body.getBoundingClientRect().right - 1,
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        {
          recordPage: true,
          chatter: true,
          activity: true,
          lineRows: 1,
          productSelector: true,
          formRowsAtLeast28: true,
          editorIdle: true,
          asideRailWidth: true,
          asideBesideBody: true,
          horizontalOverflow: false,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#sale-order-line-form')
          form.noValidate = true
          form.querySelector('[name="productId"]').value = ''
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-page-controller"] [data-ui="notice"][data-tone="danger"]')`,
      )
      await evaluate(
        cdp,
        `(() => {
          globalThis.__saleSaveNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          const form = document.querySelector('#sale-order-line-form')
          form.querySelector('[name="productId"]').value = 'variant-collab'
          form.querySelector('[name="productUomId"]').value = 'unit'
          form.querySelector('[name="productUomQty"]').value = '2'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="record-page-controller"] [data-ui="notice"][data-tone="positive"]') && document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 2`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__saleSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__saleSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__saleSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            location: location.pathname + location.search,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          chatter: true,
          activity: true,
          sidebar: true,
          location: '/admin/sales/quotations/quotation-collab?lang=vi',
          overflow: false,
        },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(saleOrderEvidenceDir, 'sales-order-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/sales/quotations/quotation-collab?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('#sale-order-line-form') && document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Order information')`), true)
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(saleOrderEvidenceDir, 'sales-order-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/sales/quotations/quotation-collab?lang=vi`)
      await waitFor(cdp, screen.ready, 15_000)
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            formRowsAtLeast28: Array.from(document.querySelectorAll('#sale-order-line-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            chatterBelowSheet: document.querySelector('[data-ui="record-page-aside"]').getBoundingClientRect().top >= document.querySelector('[data-ui="record-page-body"]').getBoundingClientRect().bottom
          })`,
        ),
        { horizontalOverflow: false, formRowsAtLeast28: true, chatterBelowSheet: true },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(saleOrderEvidenceDir, 'sales-order-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/sales/quotations/quotation-collab?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('#sale-order-line-form') && document.querySelector('[data-ui="chatter"][data-state="ready"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(saleOrderEvidenceDir, 'sales-order-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'sales-order-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            customer: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Trần Điều Phối'),
            invoiceStatus: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('Chờ lập hoá đơn'),
            detailLink: Boolean(document.querySelector('[data-ui="ket-table"] a[href*="record=sale.order%3Asales-order-collab"]')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          customer: true,
          invoiceStatus: true,
          detailLink: true,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(salesOrderListEvidenceDir, 'sales-orders-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/sales/orders?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'en'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            title: document.querySelector('[data-ui="list-page-title"]')?.textContent.trim() === 'Sales Orders',
            invoiceStatus: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('To Invoice'),
            localizedLink: Boolean(document.querySelector('[data-ui="ket-table"] a[href="/admin/sales/orders?lang=en&record=sale.order%3Asales-order-collab"]')),
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        { title: true, invoiceStatus: true, localizedLink: true, overflow: false },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(salesOrderListEvidenceDir, 'sales-orders-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/sales/orders?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            tableVisible: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.getBoundingClientRect().height > 0,
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]'))
          })`,
        ),
        { horizontalOverflow: false, tableVisible: true, chatter: false },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(salesOrderListEvidenceDir, 'sales-orders-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/sales/orders?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="table"], [data-ui="ket-table"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts) await capture(cdp, join(salesOrderListEvidenceDir, 'sales-orders-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'sales-invoicing-policy') {
      const policyModal = async (lang: 'vi' | 'en') => {
        await navigate(
          cdp,
          `${e2e.baseUrl}/admin/sales/invoicing-policies?lang=${lang}&record=sale.invoicePolicy%3Anew`,
        )
        await waitFor(
          cdp,
          `${recordForm('sale.invoicePolicy')}?.querySelector('[name="templateId"]')?.getBoundingClientRect().height >= 28 && document.documentElement.lang === '${lang}'`,
        )
      }
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'sale.invoicePolicy')),
          ...(await evaluate<Record<string, number | boolean>>(
            cdp,
            `({
              listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
              productSelect: ${recordForm('sale.invoicePolicy')}.querySelector('[name="templateId"]')?.tagName === 'SELECT',
              radios: ${recordForm('sale.invoicePolicy')}.querySelectorAll('[name="invoicePolicy"][type="radio"]').length,
              rowsAtLeastOne: document.querySelectorAll('[data-ui="kt-row"]').length >= 1,
              deliveredPolicy: document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Theo số lượng giao')
            })`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          listPage: true,
          productSelect: true,
          radios: 2,
          rowsAtLeastOne: true,
          deliveredPolicy: true,
        },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts)
        await capture(cdp, join(invoicingPolicyEvidenceDir, 'invoicing-policy-vi-desktop.png'))

      await policyModal('en')
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            localized: document.querySelector('[data-ui="list-page-title"]')?.textContent.trim() === 'Invoicing Policies' && document.querySelector('[data-ui="ket-table"]')?.textContent.includes('Delivered quantities'),
            productSelectVisible: ${recordForm('sale.invoicePolicy')}.querySelector('[name="templateId"]')?.getBoundingClientRect().width > 100,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        { localized: true, productSelectVisible: true, overflow: false },
      )
      await evaluate(cdp, `scrollTo(0, 0)`)
      if (!noArtifacts)
        await capture(cdp, join(invoicingPolicyEvidenceDir, 'invoicing-policy-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      for (const lang of ['vi', 'en'] as const) {
        await policyModal(lang)
        assert.equal(
          await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
          false,
        )
        await evaluate(cdp, `scrollTo(0, 0)`)
        if (!noArtifacts)
          await capture(cdp, join(invoicingPolicyEvidenceDir, `invoicing-policy-${lang}-mobile.png`))
      }

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'lot-list') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            listPage: Boolean(document.querySelector('[data-ui="list-page"]')),
            rowsAtLeastOne: document.querySelectorAll('[data-ui="table"] [data-ui="row"], [data-ui="kt-row"]').length >= 1,
            onHand: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.textContent.includes('12'),
            detailLink: Boolean(document.querySelector('[data-ui="ket-table"] a[href*="record=stock.lot%3Alot-collab"]')),
            createLink: Boolean(document.querySelector('[data-ui="list-page-actions"] a[href*="record=stock.lot%3Anew"]')),
            inlineCreate: Boolean(document.querySelector('#lot-create-form')),
            chatter: Boolean(document.querySelector('ket-island[data-island="mail.chatter"]')),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          listPage: true,
          rowsAtLeastOne: true,
          onHand: true,
          detailLink: true,
          createLink: true,
          inlineCreate: false,
          chatter: false,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-list-vi-desktop.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/lots?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(await evaluate(cdp, `document.body.textContent.includes('Lots and serial numbers')`), true)
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-list-en-desktop.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/lots?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'vi'`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            createVisible: document.querySelector('[data-ui="list-page-actions"] a[href*="record=stock.lot%3Anew"]')?.getBoundingClientRect().height >= 28,
            listVisible: document.querySelector('[data-ui="table"], [data-ui="ket-table"]')?.getBoundingClientRect().height > 0
          })`,
        ),
        {
          horizontalOverflow: false,
          createVisible: true,
          listVisible: true,
        },
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-list-vi-mobile.png'))

      await navigate(cdp, `${e2e.baseUrl}/admin/stock/lots?lang=en`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"]') && document.documentElement.lang === 'en'`,
      )
      assert.equal(
        await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
        false,
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-list-en-mobile.png'))

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    }
    if (screen.name === 'lot-create') {
      const lotModal = async (lang: 'vi' | 'en') => {
        await navigate(cdp, `${e2e.baseUrl}/admin/stock/lots?lang=${lang}&record=stock.lot%3Anew`)
        await waitFor(
          cdp,
          `${recordForm('stock.lot')}?.querySelector('[name="name"]') && document.documentElement.lang === '${lang}'`,
        )
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await lotModal('vi')
      assert.deepEqual(
        {
          ...(await createModalLayout(cdp, 'stock.lot')),
          ...(await evaluate<Record<string, boolean>>(
            cdp,
            `(() => {
              const form = ${recordForm('stock.lot')}
              return {
                productSelector: form.querySelector('[name="productId"]')?.tagName === 'SELECT',
                productLabel: form.querySelector('[name="productId"]')?.textContent.includes('Áo khoác vận hành · OPS-JACKET'),
                controlsWiderThanLabels: [...form.querySelectorAll('[data-ui="field"]')].every((field) => {
                  const label = field.querySelector('[data-ui="field-label"]')
                  const control = field.querySelector('[data-ui="field-control"]')
                  return !label || !control || control.getBoundingClientRect().width > label.getBoundingClientRect().width
                })
              }
            })()`,
          )),
        },
        {
          recordModal: true,
          fieldsAtLeast28: true,
          chatter: false,
          horizontalOverflow: false,
          productSelector: true,
          productLabel: true,
          controlsWiderThanLabels: true,
        },
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-create-vi-compact-desktop.png'))
      await lotModal('en')
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-create-en-compact-desktop.png'))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      for (const lang of ['vi', 'en'] as const) {
        await lotModal(lang)
        assert.equal(
          await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`),
          false,
        )
        if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, `lot-create-${lang}-mobile.png`))
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await lotModal('vi')
      await submitRecordForm(cdp, 'stock.lot', {
        productId: 'variant-collab',
        name: 'LOT/BROWSER/0085',
        ref: 'BROWSER-REF-85',
        note: 'Được tạo qua form riêng.',
      })
      await waitFor(cdp, openedRecord('stock.lot'))
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="list-page"] [data-ui="ket-table"]')?.textContent.includes('LOT/BROWSER/0085')`,
      )
    }
    if (screen.name === 'lot-detail-chatter') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            aside: Boolean(document.querySelector('[data-ui="form-page-aside"]')),
            editorIdle: document.querySelector('ket-island[data-island="stock.editor"] [data-record-save-status]')?.hidden === true,
            formRowsAtLeast28: Array.from(document.querySelectorAll('#lot-detail-form [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="form-page-body"]').getBoundingClientRect().width,
            collaborationAtLeast32rem: document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width >= 512,
            collaborationAboutThird: (() => {
              const aside = document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width
              const layout = document.querySelector('[data-ui="form-page-layout"]').getBoundingClientRect().width
              return Math.abs(aside / layout - 1 / 3) <= 0.01
            })(),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          aside: true,
          editorIdle: true,
          formRowsAtLeast28: true,
          collaborationNarrower: true,
          collaborationAtLeast32rem: true,
          collaborationAboutThird: true,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-detail-vi-desktop.png'))
      await evaluate(
        cdp,
        `(() => {
          globalThis.__lotSaveNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          const form = document.querySelector('#lot-detail-form')
          form.querySelector('[name="ref"]').value = 'NCC-LOT-84-BROWSER'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-controller"] [data-ui="notice"][data-tone="positive"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__lotSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__lotSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__lotSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            editorVisible: document.querySelector('ket-island[data-island="stock.editor"] [data-record-save-status]')?.hidden === false,
            savedReference: document.querySelector('#lot-detail-form [name="ref"]')?.value === 'NCC-LOT-84-BROWSER',
            formReady: document.querySelector('#lot-detail-form')?.getAttribute('aria-busy') !== 'true'
          })`,
        ),
        {
          chatter: true,
          activity: true,
          sidebar: true,
          editorVisible: true,
          savedReference: true,
          formReady: true,
        },
      )
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('#lot-detail-form')
          const product = form.querySelector('[name="productId"]')
          product.add(new Option('Missing product', 'missing-product'))
          product.value = 'missing-product'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-controller"] [data-ui="notice"][data-tone="danger"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__lotSaveNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__lotSaveNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__lotSaveNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            editorError: Boolean(document.querySelector('[data-ui="form-page-controller"] [data-ui="notice"][data-tone="danger"]')),
            formReady: document.querySelector('#lot-detail-form')?.getAttribute('aria-busy') !== 'true'
          })`,
        ),
        {
          chatter: true,
          activity: true,
          sidebar: true,
          editorError: true,
          formReady: true,
        },
      )
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/lots/lot-collab?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-aside"] [data-ui="chatter"][data-state="ready"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const body = document.querySelector('[data-ui="form-page-body"]').getBoundingClientRect()
            const aside = document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect()
            return {
              stacked: aside.top >= body.bottom - 1,
              chatterTopPadding: Number.parseFloat(getComputedStyle(document.querySelector('[data-ui="form-page-aside"]')).paddingTop) > 0,
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              chatterVisible: aside.height > 0
            }
          })()`,
        ),
        { stacked: true, chatterTopPadding: true, horizontalOverflow: false, chatterVisible: true },
      )
      if (!noArtifacts) await capture(cdp, join(lotEvidenceDir, 'lot-detail-vi-mobile.png'))
    }
    if (screen.name === 'transfer-chatter') {
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            formPage: Boolean(document.querySelector('[data-ui="form-page"]')),
            aside: Boolean(document.querySelector('[data-ui="form-page-aside"]')),
            editorIdle: document.querySelector('ket-island[data-island="stock.editor"] [data-record-save-status]')?.hidden === true,
            formRowsAtLeast28: Array.from(document.querySelectorAll('form[data-scope="stock-transfer"] [data-ui="form-field"]')).every((field) => field.getBoundingClientRect().height >= 28),
            collaborationNarrower: document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width < document.querySelector('[data-ui="form-page-body"]').getBoundingClientRect().width,
            collaborationAboutThird: (() => {
              const aside = document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect().width
              const layout = document.querySelector('[data-ui="form-page-layout"]').getBoundingClientRect().width
              return Math.abs(aside / layout - 1 / 3) <= 0.01
            })(),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
          })`,
        ),
        {
          formPage: true,
          aside: true,
          editorIdle: true,
          formRowsAtLeast28: true,
          collaborationNarrower: true,
          collaborationAboutThird: true,
          horizontalOverflow: false,
        },
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-detail-vi-desktop.png'))
      await evaluate(
        cdp,
        `(() => {
          globalThis.__transferActionNodes = {
            chatter: document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: document.querySelector('[data-ui="sidebar-foot"]')
          }
          document.querySelector('form[data-scope="stock-transfer"] input[name="action"][value="confirm"]').form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-controller"] [data-ui="notice"][data-tone="positive"]') && document.querySelector('[data-ui="form-page-header"]')?.textContent.includes('Đã xác nhận')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `({
            chatter: globalThis.__transferActionNodes.chatter === document.querySelector('ket-island[data-island="mail.chatter"]'),
            activity: globalThis.__transferActionNodes.activity === document.querySelector('ket-island[data-island="activity.record"]'),
            sidebar: globalThis.__transferActionNodes.sidebar === document.querySelector('[data-ui="sidebar-foot"]'),
            editorVisible: document.querySelector('ket-island[data-island="stock.editor"] [data-record-save-status]')?.hidden === false,
            formReady: Array.from(document.querySelectorAll('form[data-scope="stock-transfer"]')).every((form) => form.getAttribute('aria-busy') !== 'true')
          })`,
        ),
        { chatter: true, activity: true, sidebar: true, editorVisible: true, formReady: true },
      )
      await evaluate(cdp, `document.querySelector('[data-ui="chatter-kind"][data-kind="note"]').click()`)
      await waitFor(cdp, `document.querySelector('[data-ui="chatter-composer"]')`)
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="chatter-composer"]')
          form.querySelector('[name="body"]').value = 'Headless note on transfer'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Headless note on transfer')`)
      assert.ok(
        await evaluate<number>(
          cdp,
          `document.querySelectorAll('[data-ui="chatter-message"][data-kind="note"]').length`,
        ),
      )
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await navigate(cdp, `${e2e.baseUrl}/admin/stock/transfers/pick-collab?lang=vi`)
      await waitFor(
        cdp,
        `document.querySelector('[data-ui="form-page-aside"] [data-ui="chatter"][data-state="ready"]')`,
      )
      assert.deepEqual(
        await evaluate(
          cdp,
          `(() => {
            const body = document.querySelector('[data-ui="form-page-body"]').getBoundingClientRect()
            const aside = document.querySelector('[data-ui="form-page-aside"]').getBoundingClientRect()
            return {
              stacked: aside.top >= body.bottom - 1,
              chatterTopPadding: Number.parseFloat(getComputedStyle(document.querySelector('[data-ui="form-page-aside"]')).paddingTop) > 0,
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            }
          })()`,
        ),
        { stacked: true, chatterTopPadding: true, horizontalOverflow: false },
      )
      if (!noArtifacts) await capture(cdp, join(transferEvidenceDir, 'transfer-detail-vi-mobile.png'))
    }
    if (screen.name === 'calendar-agenda') {
      const dateLayout = await evaluate<{
        sameRow: boolean
        sameSize: boolean
        contained: boolean
      }>(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="calendar-create"]')
          const start = form.querySelector('[name="start"]')
          const stop = form.querySelector('[name="stop"]')
          const startBox = start.getBoundingClientRect()
          const stopBox = stop.getBoundingClientRect()
          const formBox = form.getBoundingClientRect()
          return {
            sameRow: Math.abs(startBox.top - stopBox.top) <= 1,
            sameSize: Math.abs(startBox.width - stopBox.width) <= 1 &&
              Math.abs(startBox.height - stopBox.height) <= 1,
            contained: [...form.querySelectorAll('input')].every((input) => {
              const box = input.getBoundingClientRect()
              return box.left >= formBox.left - 1 && box.right <= formBox.right + 1
            })
          }
        })()`,
      )
      assert.deepEqual(dateLayout, { sameRow: true, sameSize: true, contained: true })
      await evaluate(
        cdp,
        `(() => {
          const form = document.querySelector('[data-ui="calendar-create"]')
          form.querySelector('[name="name"]').value = 'Sự kiện từ Browser E2E'
          form.querySelector('[name="start"]').value = '2026-08-20T14:00'
          form.querySelector('[name="stop"]').value = '2026-08-20T15:00'
          form.querySelector('[name="location"]').value = 'Phòng kiểm chứng'
          form.requestSubmit()
          return true
        })()`,
      )
      await waitFor(cdp, `document.body.textContent.includes('Sự kiện từ Browser E2E')`)
    }
    if (!noArtifacts && !onlyScreen) await capture(cdp, join(artifactDir, `${screen.name}.png`))
    if (['lot-detail-chatter', 'transfer-chatter'].includes(screen.name))
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      })
    if (clock) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clock.identifier })
  }

  if (!noArtifacts && !onlyScreen)
    await writeFile(
      join(artifactDir, 'browser-e2e.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          viewport: { width: 1440, height: 1100 },
          assertions: [
            'authenticated product and transfer islands reached ready state',
            'Product save replaced only its record header/body and preserved Chatter, Activity and sidebar DOM identity',
            'Transfer actions replaced only the record header/body and preserved Chatter, Activity and sidebar DOM identity',
            'Inventory adjustment selected a product, applied a count through real browser HTTP and rendered no Chatter',
            'Transfer list rendered the domain contract operational columns, created a transfer and rendered no list-level Chatter',
            'Warehouse configuration rendered the domain contract shipment-step radios, created a warehouse and rendered no Chatter',
            'Location configuration rendered complete names, created a child location and rendered no Chatter',
            'Lot list rendered human product labels and internal-location on-hand quantities, created a lot and rendered no collection-level Chatter',
            'Lot detail kept its collaboration column near one third of the large viewport and at least 32rem wide',
            'message and internal-note composer crossed real browser HTTP',
            'Chatter exposed linked sent and terminal-failure email delivery states',
            'record activity island scheduled and completed an activity through real browser HTTP',
            'My Activities rendered the actor due list and sidebar counter',
            'My Activities kept inputs, date pickers and semantic actions on one contained baseline',
            'KétViệt sidebar systray order, divider and account menu stayed functional',
            'Agenda, week and month calendar views hydrated with bounded occurrence expansion',
            'calendar date-time pickers kept equal dimensions and stayed inside their form grid',
            'calendar event creation crossed real browser HTTP and remained visible after reload',
            'transactional outbox rendered both provider-accepted and terminal-failure delivery states',
            'inbound log rendered processed, failed and ignored signed-provider outcomes',
            'plain-text message markup did not execute or create an img element',
            'notification inbox rendered an unread message',
          ],
          screens: report,
        },
        null,
        2,
      )}\n`,
    )
  for (const row of report)
    console.log(
      `${row.screen.padEnd(24)} navigation=${row.navigationMs.toFixed(1).padStart(6)} ms  interactive=${row.readyMs.toFixed(1).padStart(6)} ms`,
    )
  if (!noArtifacts) console.log(`screenshots: ${artifactDir}`)
} finally {
  chrome?.cdp.close()
  if (chrome?.process.exitCode === null) {
    chrome.process.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolveExit) => chrome?.process.once('exit', () => resolveExit())),
      delay(2_000).then(() => {
        if (chrome?.process.exitCode === null) chrome.process.kill('SIGKILL')
      }),
    ])
  }
  if (chrome)
    await rm(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
      () => {},
    )
  await e2e.close()
}
