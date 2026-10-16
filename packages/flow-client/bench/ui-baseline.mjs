// What the Flow client costs today, measured before the production read contract
// is written. Development-only: it drives the Atlas fixture, never a deployment.
//
// In process (always): the bootstrap read at several organization sizes, its bytes
// raw/gzip/brotli, JSON.parse, and the view build of the main screens from that data.
// Over HTTP (--base): document, bootstrap and the module graph of a running Atlas
// server. Atlas holds every function call 120ms on purpose; HTTP figures report it.
//
// Run from the package directory after building ketsuite:
//   node bench/ui-baseline.mjs [--scales=1,4,16,40] [--rounds=7] [--base=http://127.0.0.1:4240]
//     [--store=<module exporting createOrganizationSession>] [--json=<file>]
import { performance } from 'node:perf_hooks'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const SCALES = arg('scales', '1,4,16,40').split(',').map(Number)
const ROUNDS = Number(arg('rounds', 7))
const BASE = arg('base', '')
const TODAY = '2026-10-11'
const ATLAS_HOLD_MS = 120
const SCREENS = [
  ['my-work', {}],
  ['all-issues', {}],
  ['board', { project: 'core' }],
  ['workspace-overview', {}],
  ['inbox', {}],
  ['issue', { record: 'KV-142', recordProvided: true }],
]
const { createOrganizationSession } = await import(
  arg('store', '') ? pathToFileURL(resolve(arg('store'))).href : '../atlas/organization-store.mjs'
)
setFlowLocale('vi')

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]
const ms = (x) => Math.round(x * 10) / 10
const kb = (n) => Math.round(n / 102.4) / 10
const sizes = (text) => ({
  raw: Buffer.byteLength(text),
  gzip: gzipSync(text).length,
  brotli: brotliCompressSync(text).length,
})
const timed = (fn) => {
  const t = performance.now()
  const value = fn()
  return [performance.now() - t, value]
}

// Copies every task (with its history and comments) k-1 times inside the same
// projects, so lists, groups and boards grow the way a busier organization would.
function scale(data, k) {
  if (k <= 1) return
  const tasks = data.tasks.slice(),
    history = data.history.slice(),
    comments = data.comments.slice()
  for (let n = 1; n < k; n++) {
    const id = (x) => (x ? `${x}~${n}` : x)
    for (const t of tasks)
      data.tasks.push({
        ...t,
        id: id(t.id),
        parentId: id(t.parentId),
        blockedBy: [],
        order: t.order + n * 1e4,
      })
    for (const h of history) data.history.push({ ...h, id: id(h.id), taskId: id(h.taskId) })
    for (const c of comments) data.comments.push({ ...c, id: id(c.id), taskId: id(c.taskId) })
  }
}

// The controller only needs a lifetime and an inert root to resolve its read.
globalThis.window ??= new EventTarget()
globalThis.MutationObserver ??= class {
  observe() {}
  disconnect() {}
}
const root = () =>
  Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    closest: () => null,
    setAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  })

async function screenCost(fixture, screen, props) {
  const lifetime = new AbortController()
  const call = createFnClient({
    fetch: async (url, request) =>
      new Response(
        JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  })
  const island = createFlowWorkspace({ screen, companyId: 'demo', ...props }, { call })
  const t0 = performance.now()
  island.mount({ root: root(), lifetime: lifetime.signal })
  await new Promise((r) => setTimeout(r, 0))
  const loaded = performance.now() - t0
  const builds = []
  let html = ''
  for (let i = 0; i < ROUNDS; i++) {
    const [t, out] = timed(() => renderToStaticString(island.view()))
    builds.push(t)
    html = out
  }
  lifetime.abort()
  island.dispose()
  return {
    screen,
    readAndParseMs: ms(loaded),
    // The first build after a read pays the model scan; later builds are re-renders
    // (menus, typing, selection) that reuse the cached model.
    firstBuildMs: ms(builds[0]),
    viewBuildMedianMs: ms(median(builds)),
    viewBuildP95Ms: ms(p95(builds)),
    htmlKB: kb(Buffer.byteLength(html)),
    elements: (html.match(/<[a-z][^\s/>]*/g) ?? []).length,
    rows: (html.match(/<tr[\s>]/g) ?? []).length,
  }
}

const inProcess = []
for (const k of SCALES) {
  const fixture = createOrganizationSession('baseline', 'my-work', { profile: 'realistic', today: TODAY })
  const data = fixture.sessions.get('demo').data
  scale(data, k)
  const computes = []
  let text = ''
  for (let i = 0; i < ROUNDS; i++) {
    const [t, r] = timed(() =>
      fixture.call('flow.workspace.bootstrap', { companyId: 'demo', route: 'my-work' }),
    )
    computes.push(t)
    text = JSON.stringify(r)
  }
  const parses = Array.from({ length: ROUNDS }, () => timed(() => JSON.parse(text))[0])
  const value = JSON.parse(text).value
  const collections = Object.entries(value)
    .map(([key, x]) => [key, kb(Buffer.byteLength(JSON.stringify(x) ?? ''))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const screens = []
  for (const [screen, props] of SCREENS) screens.push(await screenCost(fixture, screen, props))
  const row = {
    scale: k,
    tasks: data.tasks.length,
    history: data.history.length,
    bootstrap: {
      computeMedianMs: ms(median(computes)),
      parseMedianMs: ms(median(parses)),
      ...Object.fromEntries(Object.entries(sizes(text)).map(([key, n]) => [`${key}KB`, kb(n)])),
      largestKB: Object.fromEntries(collections),
    },
    screens,
  }
  inProcess.push(row)
  console.log(`\n# ×${k}: ${row.tasks} tasks, ${row.history} history`)
  console.log('bootstrap', JSON.stringify(row.bootstrap))
  console.table(screens)
}

let http = null
if (BASE) {
  const routes = [
    'my-work?company=demo&workspace=product&lang=vi',
    'all-issues?company=demo&workspace=product&lang=vi&group=status',
    'board?company=demo&workspace=product&lang=vi&project=core&group=status',
    'workspace-overview?company=demo&workspace=product&lang=vi',
  ]
  const documents = []
  let first = ''
  for (const route of routes) {
    const cold = [],
      warm = []
    let cookie = '',
      bytes = 0,
      documentWire = 0
    for (let i = 0; i <= ROUNDS; i++) {
      const t = performance.now()
      const res = await fetch(`${BASE}/flow/${route}`, {
        headers: { 'accept-encoding': 'br, gzip', ...(cookie ? { cookie } : {}) },
      })
      const body = await res.text()
      ;(i ? warm : cold).push(performance.now() - t)
      cookie ||= (res.headers.get('set-cookie') ?? '').split(';')[0]
      bytes = Buffer.byteLength(body)
      documentWire = Number(res.headers.get('content-length') ?? bytes)
      first ||= body
    }
    const session = JSON.parse(first.match(/id="flow-environment">([^<]+)</)[1]).session
    const reads = []
    let readBytes = 0,
      readWire = 0,
      encoding = ''
    for (let i = 0; i < ROUNDS; i++) {
      const t = performance.now()
      const res = await fetch(`${BASE}/_ket/fn/flow.workspace.bootstrap`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-flow-fixture': session,
          'accept-encoding': 'gzip, br',
        },
        body: JSON.stringify({ route: route.split('?')[0] }),
      })
      readBytes = Buffer.byteLength(await res.text())
      readWire = Number(res.headers.get('content-length') ?? readBytes)
      encoding = res.headers.get('content-encoding') ?? 'identity'
      reads.push(performance.now() - t)
    }
    documents.push({
      route: route.split('?')[0],
      documentColdMs: ms(cold[0]),
      documentWarmMedianMs: ms(median(warm)),
      documentKB: kb(bytes),
      documentWireKB: kb(documentWire),
      bootstrapMedianMs: ms(median(reads)),
      bootstrapLessHoldMs: ms(median(reads) - ATLAS_HOLD_MS),
      bootstrapKB: kb(readBytes),
      bootstrapWireKB: kb(readWire),
      bootstrapEncoding: encoding,
    })
  }
  // Module graph the first document asks for: stylesheets, scripts and their
  // imports, resolved through the page's import map (bare and URL-like keys).
  // "initial" follows static imports and island entries; "lazy" is what dynamic
  // imports add on top. Fonts are excluded. Wire bytes are the compressed body.
  const imports = JSON.parse(first.match(/<script type="importmap">([^<]+)</)[1]).imports
  const bare = (spec) =>
    imports[spec] ??
    Object.entries(imports)
      .filter(([key]) => key.endsWith('/') && spec.startsWith(key))
      .map(([key, to]) => to + spec.slice(key.length))[0]
  const files = new Map()
  const load = async (path) => {
    if (files.has(path)) return files.get(path)
    const res = await fetch(BASE + path, { headers: { 'accept-encoding': 'br, gzip' } })
    const text = res.ok ? await res.text() : null
    const entry =
      text === null ? null : { ...sizes(text), wire: Number(res.headers.get('content-length') ?? 0), text }
    files.set(path, entry)
    return entry
  }
  const edges = (path, text) => {
    const found = path.split('?')[0].endsWith('.css')
      ? [...text.matchAll(/@import\s+(?:url\()?["']?([^"')]+\.css)/g)].map((m) => [m[1], false])
      : [
          ...[...text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map((m) => [m[1], false]),
          ...[...text.matchAll(/import\s*\(\s*["']([^"']+)["']/g)].map((m) => [m[1], true]),
          // islands.js names island and behavior entries as {"src":"/…"}.
          ...[...text.matchAll(/"src":"(\/[^"]+\.m?js)"/g)].map((m) => [m[1], false]),
        ]
    return found
      .map(([spec, dynamic]) => {
        const to =
          spec.startsWith('.') || spec.startsWith('/') ? new URL(spec, BASE + path).pathname : bare(spec)
        return [to && (imports[to] ?? to), dynamic]
      })
      .filter(([to]) => to)
  }
  const walk = async (roots, followDynamic) => {
    const seen = new Set(),
      queue = [...roots]
    while (queue.length) {
      const path = queue.shift()
      if (seen.has(path)) continue
      seen.add(path)
      const entry = await load(path)
      if (!entry) continue
      for (const [to, dynamic] of edges(path, entry.text)) if (followDynamic || !dynamic) queue.push(to)
    }
    return seen
  }
  const roots = [
    ...[...first.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]),
    ...[...first.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ]
  const initial = await walk(roots, false)
  const everything = await walk(roots, true)
  const total = (paths, css) =>
    [...paths]
      .map((p) => [p, files.get(p)])
      .filter(([p, x]) => x && p.split('?')[0].endsWith('.css') === css)
      .reduce(
        (a, [, x]) => ({
          raw: a.raw + x.raw,
          gzip: a.gzip + x.gzip,
          brotli: a.brotli + x.brotli,
          wire: a.wire + x.wire,
          files: a.files + 1,
        }),
        { raw: 0, gzip: 0, brotli: 0, wire: 0, files: 0 },
      )
  const lazyPaths = [...everything].filter((p) => !initial.has(p))
  const largest = [...initial]
    .map((p) => [p, files.get(p)])
    .filter(([, x]) => x)
    .sort((a, b) => b[1].raw - a[1].raw)
    .slice(0, 8)
    .map(([p, x]) => ({ path: p, rawKB: kb(x.raw), brotliKB: kb(x.brotli), wireKB: kb(x.wire) }))
  const kbOf = (x) => ({
    files: x.files,
    rawKB: kb(x.raw),
    gzipKB: kb(x.gzip),
    brotliKB: kb(x.brotli),
    wireKB: kb(x.wire),
  })
  http = {
    base: BASE,
    holdMs: ATLAS_HOLD_MS,
    documents,
    scripts: kbOf(total(initial, false)),
    styles: kbOf(total(initial, true)),
    lazyScripts: kbOf(total(lazyPaths, false)),
    lazy: lazyPaths.map((p) => ({ path: p, rawKB: kb(files.get(p)?.raw ?? 0) })),
    largest,
  }
  console.log('\n# HTTP', BASE)
  console.table(documents)
  console.log(
    'scripts',
    JSON.stringify(http.scripts),
    '\nstyles',
    JSON.stringify(http.styles),
    '\nlazy',
    JSON.stringify(http.lazyScripts),
  )
  console.table(largest)
}

const out = arg('json', '')
if (out)
  await writeFile(
    out,
    JSON.stringify({ node: process.version, rounds: ROUNDS, today: TODAY, inProcess, http }, null, 2) + '\n',
  )
