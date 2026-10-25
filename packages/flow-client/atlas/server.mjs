import { createServer } from 'node:http'
import { realpathSync, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib'
import { dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { renderIsland, renderToString, trustedMarkup, html } from '@ketvietlab/ketjs-view'
import {
  createKetServer,
  compose,
  sqliteAdapter,
  navigablePage,
  isNavigationRequest,
  multipart,
} from '@ketvietlab/ketjs'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import { setFlowLocale, normalizeFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { flowShellData } from '@ketvietlab/flow-client/shell-model.mjs'
import { atlasShellRequest, atlasShellProps } from './shell-request.mjs'
import { createOrganizationSession } from './organization-store.mjs'
import { fixtureResponse } from './fixture-response.mjs'
import { atlasFlowCommand } from '@ketvietlab/flow-client/command-contract.mjs'
import { BLANK_OWNER, blankStages } from './blank-organization.mjs'
import { todayDate } from '@ketvietlab/flow-client/timeline.mjs'
import { notFoundPage } from './not-found-page.mjs'
// Every entry point (including KetAtlas's renderer command) needs these browser bundles.
import './build-vendor.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const ui = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/flow-ui')))
const vendor = fileURLToPath(new URL('./vendor/', import.meta.url))
const view = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/ketjs-view')))
const tokens = fileURLToPath(import.meta.resolve('@ketvietlab/design-system/tokens.css'))
const designSystem = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/design-system')))
// Seeded dates follow the browser's calendar (the client computes "overdue" from
// the real date), so the mock never ages into "everything is overdue".
const atlasToday = () => todayDate('Asia/Ho_Chi_Minh')
export async function startAtlasServer({
  createSession = createOrganizationSession,
  extraImports = {},
  extraStyles = [],
  extraMounts = [],
  entry = '/atlas/entry.mjs',
  entryFile,
} = {}) {
  const args = process.argv.slice(2)
  const port = Number(args[args.indexOf('--port') + 1] || process.env.KETATLAS_HTML_PORT || 4192)
  const previewPort = port + 1
  const sessions = new Map()
  // In-memory upload store for the mock. Ids are random capability URLs; production must authorize every read.
  const uploads = new Map()
  const MAX_UPLOAD = 25 * 1024 * 1024,
    MAX_UPLOADS_TOTAL = 256 * 1024 * 1024
  const inlineTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/ogg',
  ])
  const storeUpload = (upload) => {
    const id = randomUUID()
    uploads.set(id, upload)
    let total = 0
    for (const u of uploads.values()) total += u.bytes.length
    for (const [key, u] of uploads) {
      if (total <= MAX_UPLOADS_TOTAL) break
      uploads.delete(key)
      total -= u.bytes.length
    }
    return id
  }
  const serveUpload = (req, res, upload, download) => {
    const inline = !download && inlineTypes.has(upload.type)
    const headers = {
      'content-type': inline ? upload.type : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'accept-ranges': 'bytes',
    }
    const size = upload.bytes.length,
      range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        return res.end()
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
      })
      return res.end(req.method === 'HEAD' ? undefined : upload.bytes.subarray(start, end + 1))
    }
    res.writeHead(200, { ...headers, 'content-length': size })
    res.end(req.method === 'HEAD' ? undefined : upload.bytes)
  }
  const types = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
  }
  const stylesheets = `<link rel="icon" type="image/png" href="/flow-client/brand/logo-flow-light-160.png"><link rel="stylesheet" href="/design-system/tokens.css"><link rel="stylesheet" href="/design-system/styles.css"><link rel="stylesheet" href="/flow-ui/styles.css">${extraStyles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="/flow-client/brand/brand.css">`
  const imports = {
    '@ketvietlab/ketjs-view/jsx-runtime': '/_ket/view/jsx-runtime.js',
    '@ketvietlab/ketjs': '/flow-ketjs-i18n.mjs',
    '@ketvietlab/ketjs-view': '/_ket/view/index.js',
    '@ketvietlab/design-system/date-picker': '/flow-client/vendor/date-picker.mjs',
    '@ketvietlab/design-system/date-picker/runtime': '/flow-client/vendor/date-picker-runtime.mjs',
    '@ketvietlab/flow-ui': '/flow-client/workspace.browser.mjs',
    '@ketvietlab/flow-ui/documents': '/flow-ui/documents.mjs',
    '@ketvietlab/flow-ui/workspace': '/flow-client/workspace.browser.mjs',
    '@ketvietlab/flow-ui/i18n': '/flow-ui/i18n.mjs',
    '@ketvietlab/flow-ui/runtime': '/flow-client/workspace.browser.mjs',
    '@ketvietlab/flow-client': '/flow-client/workspace.browser.mjs',
    '@ketvietlab/flow-client/api': '/flow-client/api.mjs',
    '@ketvietlab/flow-client/': '/flow-client/',
    ...extraImports,
  }
  const mounts = [
    ['/_ket/view/', view],
    ['/flow-ui/', ui],
    ['/design-system/', designSystem],
    ...extraMounts,
    ['/flow-client/', resolve(root, 'dist')],
    ['/atlas/', resolve(root, 'atlas')],
  ]
  // A document has one language (switching starts a new SSR document), so the
  // browser loads only that locale of each message catalog: the import map
  // redirects every catalog module, bare or relative, to its `?locale=` variant.
  const catalogs = mounts
    .filter(([prefix, base]) => prefix !== '/atlas/' && existsSync(resolve(base, 'messages.mjs')))
    .map(([prefix]) => prefix + 'messages.mjs')
  const documentImports = (lang) => {
    const localized = Object.fromEntries(catalogs.map((path) => [path, `${path}?locale=${lang}`]))
    for (const [spec, target] of Object.entries(imports))
      if (spec.endsWith('/') && localized[target + 'messages.mjs'])
        localized[spec + 'messages.mjs'] = localized[target + 'messages.mjs']
    return { ...imports, ...localized }
  }
  const localeModule = async (file, lang) => {
    const catalog = await import(pathToFileURL(file).href)
    return Object.entries(catalog)
      .map(
        ([name, value]) =>
          `export const ${name} = ${JSON.stringify(value && typeof value === 'object' && lang in value ? { [lang]: value[lang] } : value)}\n`,
      )
      .join('')
  }
  // Compress the way a production edge would. Dynamic bodies use fast settings;
  // static files are compressed once per build (path + mtime) at full quality.
  const compressed = new Map()
  const encodingOf = (req) => {
    const accept = String(req?.headers['accept-encoding'] ?? '')
    return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null
  }
  const encode = (encoding, bytes, quality) =>
    encoding === 'br'
      ? brotliCompressSync(bytes, {
          params: {
            [zlib.BROTLI_PARAM_QUALITY]: quality,
            [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length,
          },
        })
      : gzipSync(bytes, { level: quality > 5 ? 9 : 6 })
  const send = (res, code, headers, body, cacheKey) => {
    const bytes = typeof body === 'string' ? Buffer.from(body) : body
    const encoding = bytes.length > 1024 ? encodingOf(res.req) : null
    const vary = [headers.vary, 'Accept-Encoding'].filter(Boolean).join(', ')
    if (!encoding) {
      res.writeHead(code, { ...headers, vary, 'content-length': bytes.length })
      return res.end(res.req?.method === 'HEAD' ? undefined : bytes)
    }
    const key = cacheKey && `${cacheKey}:${encoding}`
    let out = key && compressed.get(key)
    if (!out) {
      out = encode(encoding, bytes, cacheKey ? 11 : 5)
      if (key) compressed.set(key, out)
    }
    res.writeHead(code, {
      ...headers,
      vary,
      'content-encoding': encoding,
      'content-length': out.length,
    })
    res.end(res.req?.method === 'HEAD' ? undefined : out)
  }
  const json = (res, code, value) =>
    send(
      res,
      code,
      { 'content-type': 'application/json', 'cache-control': 'no-store' },
      JSON.stringify(value),
    )
  const serialize = (x) => JSON.stringify(x).replace(/</g, '\\u003c')
  // Use KetJS's published browser runtime; do not copy its navigation code.
  const buildId = createHash('sha256')
    .update(await readFile(resolve(root, 'dist/workspace.mjs')))
    .digest('hex')
    .slice(0, 16)
  const runtimeAdapter = sqliteAdapter(':memory:')
  const framework = await createKetServer({
    manifest: compose([], { companies: true }),
    adapter: runtimeAdapter,
    buildId,
    islandClients: { 'flow.workspace': { src: entry, export: 'createAtlasWorkspace' } },
    browserBehaviors: {
      'flow.navigation': {
        src: '/atlas/entry.mjs',
        export: 'attachAtlasNavigation',
        when: '[data-flow-app]',
      },
    },
  })
  const handler = async (req, res) => {
    try {
      if (process.env.FLOW_DEBUG) console.log(req.method, req.url)
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = decodeURIComponent(url.pathname)
      if (path === '/_ket/islands.js') {
        framework.server.emit('request', req, res)
        return
      }
      if (path === '/flow-live-doc.mjs' || path === '/flow-ketjs-i18n.mjs') {
        const file = resolve(vendor, path === '/flow-live-doc.mjs' ? 'live-doc.mjs' : 'ketjs-i18n.mjs')
        return send(
          res,
          200,
          { 'content-type': 'text/javascript' },
          await readFile(file),
          `${file}:${(await stat(file)).mtimeMs}`,
        )
      }
      if (path === '/__atlas/ready') return json(res, 200, { ok: true })
      if (path === '/flow/context' && req.method === 'POST') {
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 4096) return json(res, 413, { ok: false })
          chunks.push(chunk)
        }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const allowed = typeof value.companyId === 'string' && value.companyId.length > 0
        return json(res, allowed ? 200 : 403, { ok: Boolean(allowed) })
      }
      if (['/_ket/upload', '/flow/uploads'].includes(path) && req.method === 'POST') {
        const session = req.headers['x-flow-fixture']
        if (!sessions.has(session))
          return json(res, 403, {
            ok: false,
            code: 'fixtureSession',
            message: 'Phiên thử nghiệm đã hết hạn. Tải lại trang.',
          })
        const chunks = []
        let size = 0
        let fileType, fileName
        const source = String(req.headers['content-type']).startsWith('multipart/form-data')
          ? (async function* () {
              for await (const part of multipart(req, String(req.headers['content-type']), {
                maxBytes: MAX_UPLOAD + 16384,
                maxParts: 4,
              })) {
                if (part.filename !== undefined) {
                  if (fileName !== undefined) throw new Error('One file per upload')
                  fileName = part.filename
                  fileType = part.type
                  yield* part.body
                }
              }
            })()
          : req
        for await (const chunk of source) {
          size += chunk.length
          if (size > MAX_UPLOAD)
            return json(res, 413, { ok: false, code: 'tooLarge', message: 'Tệp vượt quá 25 MB.' })
          chunks.push(chunk)
        }
        const type = String(fileType ?? req.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase()
        let name = 'file'
        try {
          name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 255) || 'file'
        } catch {}
        if (fileName) name = fileName.slice(0, 255)
        return json(res, 200, {
          ok: true,
          uploadId: storeUpload({
            session,
            name,
            type: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream',
            bytes: Buffer.concat(chunks),
          }),
        })
      }
      if (path.startsWith('/_ket/files/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const upload = uploads.get(path.slice('/_ket/files/'.length))
        if (!upload) return json(res, 404, { ok: false, message: 'Not found' })
        return serveUpload(req, res, upload, url.searchParams.has('download'))
      }
      if (path.startsWith('/_ket/fn/') && req.method === 'POST') {
        const session = sessions.get(req.headers['x-flow-fixture'])
        if (!session)
          return json(res, 403, {
            ok: false,
            code: 'fixtureSession',
            message: 'Phiên thử nghiệm đã hết hạn. Tải lại trang.',
          })
        session.touched = Date.now()
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 1000000) return json(res, 413, { ok: false, message: 'Dữ liệu quá lớn.' })
        }
        if (session.scenario === 'loading') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.write(' ')
          const timer = setTimeout(
            () => res.end(JSON.stringify(session.call('flow.workspace.bootstrap'))),
            120000,
          )
          res.on('close', () => clearTimeout(timer))
          return
        }
        await new Promise((r) => setTimeout(r, 120))
        const { name, input } = atlasFlowCommand(path.slice('/_ket/fn/'.length), JSON.parse(body || '{}'))
        // The client never dictates stored bytes: size and type come from the upload itself.
        if (name === 'flow.entity.save' && input.collection === 'files' && Array.isArray(input.files)) {
          for (const file of input.files) {
            if (file?.uploadId == null) continue
            const upload = uploads.get(file.uploadId)
            if (!upload || upload.session !== req.headers['x-flow-fixture'])
              return json(res, 200, {
                ok: true,
                value: {
                  ok: false,
                  errors: [{ code: 'validation', message: 'Tệp tải lên đã hết hạn. Thử lại.' }],
                },
              })
            file.size = upload.bytes.length
            file.type = upload.type
          }
        }
        const result = session.call(name, input)
        if (result.value?.screenBaseURL) result.value.screenBaseURL = `http://127.0.0.1:${previewPort}/flow/`
        return json(res, 200, fixtureResponse(session, name, result))
      }
      if (path.startsWith('/flow/')) {
        const screen = path.slice('/flow/'.length) || 'my-work'
        if (!routes[screen]) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(
            notFoundPage({
              company: url.searchParams.get('company'),
              lang: url.searchParams.get('lang'),
              head: stylesheets,
            }),
          )
        }
        const cookieName = `flow-atlas-${port}`
        const cookieSession = String(req.headers.cookie ?? '')
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(cookieName + '='))
          ?.slice(cookieName.length + 1)
        const previous = sessions.get(cookieSession)
        const scenario = url.searchParams.get('state') ?? previous?.scenario ?? 'baseline'
        const reuse = previous && previous.scenario === scenario
        const session = reuse ? cookieSession : randomUUID()
        if (!reuse)
          sessions.set(session, {
            ...createSession(scenario, screen, { profile: 'realistic', today: atlasToday() }),
            touched: Date.now(),
          })
        sessions.get(session).touched = Date.now()
        const documentLang = normalizeFlowLocale(url.searchParams.get('lang'))
        setFlowLocale(documentLang)
        const props = {
          serverShell: true,
          scope: url.searchParams.get('scope') ?? (url.searchParams.has('project') ? 'project' : 'workspace'),
          view: url.searchParams.get('view') ?? '',
          projectFilter: url.searchParams.get('projectFilter') ?? 'all',
          visibility: url.searchParams.get('visibility') ?? 'shared',
          docq: url.searchParams.get('docq') ?? '',
          returnTo: url.searchParams.get('returnTo') ?? '',
          screen,
          background: url.searchParams.get('background') ?? '',
          focus: url.searchParams.get('focus') ?? '',
          companyId: url.searchParams.get('company') ?? 'demo',
          workspaceId: url.searchParams.get('workspace') ?? '',
          record: url.searchParams.get('id') ?? 'KV-142',
          recordProvided: url.searchParams.has('id'),
          project: url.searchParams.get('project') ?? 'core',
          query: url.searchParams.get('q') ?? '',
          status: url.searchParams.get('status') ?? 'all',
          basePath: '/flow/',
          repository: url.searchParams.get('repository') ?? '',
          branch: url.searchParams.get('branch') ?? '',
          atlasPath: url.searchParams.get('atlas') ?? '',
          // Atlas has no real accounts; the blank organization shows its mock owner credential on the sign-in page.
          signInDemo: blankStages.includes(scenario)
            ? { email: BLANK_OWNER.email, password: BLANK_OWNER.password }
            : null,
        }
        // Only authorized chrome is rendered here. Business records stay in the
        // data island and are fetched through the client adapter after mount.
        const shellData = sessions
          .get(session)
          .call('flow.workspace.bootstrap', atlasShellRequest(props)).value
        const initialShellData = flowShellData(shellData)
        const shellProps = atlasShellProps(props, initialShellData)
        const island = renderIsland('flow.workspace', createFlowWorkspace, shellProps, {
          tag: 'div',
          key: ['companyId', 'workspaceId'],
        })
        const chrome = createFlowWorkspace(shellProps, { initialShellData })
        let page
        try {
          if (isNavigationRequest(req)) {
            const response = navigablePage(req, {
              title: 'Flow',
              document: () => html``,
              slots: chrome.fragmentSlots(trustedMarkup(island)),
            })
            return send(
              res,
              response.status ?? 200,
              {
                'content-type': response.type + '; charset=utf-8',
                'cache-control': 'no-store',
                'x-ket-build': buildId,
                ...response.headers,
              },
              response.body,
            )
          }
          page = renderToString(chrome.shellView(trustedMarkup(island)))
        } finally {
          chrome.dispose()
        }
        return send(
          res,
          200,
          {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-ket-build': buildId,
            vary: 'X-Ket-Navigation',
            'set-cookie': `${cookieName}=${session}; Path=/flow/; HttpOnly; SameSite=Strict`,
          },
          `<!doctype html><html lang="${documentLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flow</title>${stylesheets}<script type="importmap">${serialize({ imports: documentImports(documentLang) })}</script></head><body style="margin:0">${page}<script type="application/json" id="flow-environment">${serialize({ session })}</script><script type="module" src="/_ket/islands.js"></script></body></html>`,
        )
      }
      let file
      if (entryFile && path === entry) file = entryFile
      else if (path === '/design-system/tokens.css') file = tokens
      else {
        const mount = mounts.find(([prefix]) => path.startsWith(prefix))
        if (!mount) throw new Error('404')
        const [prefix, base, allowed] = mount
        file = resolve(base, path.slice(prefix.length))
        if (!file.startsWith(resolve(base) + sep)) throw new Error('404')
        if (allowed && !allowed.some((p) => path.slice(prefix.length).startsWith(p))) throw new Error('404')
        if (prefix === '/atlas/' && path !== '/atlas/entry.mjs') throw new Error('404')
      }
      const locale = url.searchParams.get('locale')
      if (path.endsWith('/messages.mjs') && ['en', 'ja', 'vi'].includes(locale ?? ''))
        return send(
          res,
          200,
          { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
          await localeModule(file, locale),
          `${file}:${(await stat(file)).mtimeMs}:${locale}`,
        )
      const bytes = await readFile(file)
      send(
        res,
        200,
        {
          'content-type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
        bytes,
        extname(file) === '.woff2' || extname(file) === '.png'
          ? undefined
          : `${file}:${(await stat(file)).mtimeMs}`,
      )
    } catch {
      json(res, 404, { ok: false, message: 'Not found' })
    }
  }
  const server = createServer(handler)
  const previewServer = createServer(handler)
  previewServer.listen(previewPort, '127.0.0.1')
  const sweep = setInterval(() => {
    for (const [id, s] of sessions) if (Date.now() - s.touched > 3600000) sessions.delete(id)
  }, 60000)
  sweep.unref()
  server.listen(port, '127.0.0.1', () => console.log(`Flow renderer: http://127.0.0.1:${port}/flow/my-work`))
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      clearInterval(sweep)
      server.close()
      previewServer.close()
      void runtimeAdapter.close()
    })

  return { server, previewServer }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  startAtlasServer()
