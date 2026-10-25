import {
  defineModule,
  document,
  isNavigationRequest,
  json,
  navigablePage,
  streamed,
  text,
  withHeaders,
} from '@ketvietlab/ketjs'
import type { Route, RouteEntry, Row, ServeContext } from '@ketvietlab/ketjs'
import { defineIsland, html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import type { FlowWorkspaceProps } from '@ketvietlab/flow-client/workspace.mjs'
import { normalizeFlowLocale, setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
import { flowShellData } from '@ketvietlab/flow-client/shell-model.mjs'
import { routeScope, workspaceRecordTarget } from '@ketvietlab/flow-client/navigation.mjs'
import { receiveAttachment } from '../storage/routes.ts'
import { inlineTypes } from '../storage/policy.ts'
import { documentRoutes } from '../livedoc/index.ts'
import { flowDocumentOwner } from '../flow/native/live-document.ts'
import { flowUploadKey } from '../flow/native/blob-keys.ts'
import { selectFlowContext } from './context.ts'
import { compressFlowDocument } from './compression.ts'

export type FlowWorkspaceDeliveryOptions = {
  client?: string
  export?: string
  imports?: Record<string, string>
  /** Additional public catalogues owned by an installed extension. */
  catalogues?: Record<string, URL>
  /** Map each extension's message module URL to its declared catalogue. */
  messageImports?: Record<string, string>
  view?: typeof createFlowWorkspace
}
const redirect = (location: string) => withHeaders(text('', { status: 303 }), { location })
const scriptJSON = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
const base = '/_ket/asset/flow_workspace/'
const ui = '/_ket/asset/flow/'

/** Server-rendered chrome and tabs; only the existing keyed data island is hydrated. */
export function createFlowWorkspaceModule(options: FlowWorkspaceDeliveryOptions = {}) {
  const view = options.view ?? createFlowWorkspace
  const catalogues = {
    client: new URL('./messages.mjs', import.meta.resolve('@ketvietlab/flow-client')),
    ui: new URL('./messages.mjs', import.meta.resolve('@ketvietlab/flow-ui')),
    ...options.catalogues,
  }
  const screen =
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      if (!(await ctx.requestIdentityOf(url, req)))
        return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
      const key = url.pathname.slice('/flow/'.length) || 'my-work'
      if (['sign-in', 'set-password', 'sign-up'].includes(key)) return redirect('/login')
      if (!Object.hasOwn(routes, key)) return text('Not found', { status: 404 })
      const scope = await ctx.scopeOf(url, req)
      const lang = normalizeFlowLocale(ctx.localeOf(url, req))
      const requested: FlowWorkspaceProps = {
        basePath: '/flow/',
        screen: key,
        companyId: scope.company,
        workspaceId: url.searchParams.get('workspace') ?? '',
        project: url.searchParams.get('project') ?? '',
        record: url.searchParams.get('id') ?? undefined,
        recordProvided: url.searchParams.has('id'),
        scope: url.searchParams.get('scope') ?? '',
        background: url.searchParams.get('background') ?? undefined,
        query: url.searchParams.get('q') ?? '',
        status: url.searchParams.get('status') ?? 'all',
        view: url.searchParams.get('view') ?? '',
        group: url.searchParams.get('group') ?? '',
        lang,
        serverShell: true,
        // KetSuite's own live document editor, vendored beside the Flow client.
        liveDocEditor: `${base}vendor/live-doc.mjs`,
      }
      const envelope = await ctx.call(
        'flow.workspace.bootstrap',
        {
          companyId: scope.company,
          workspaceId: requested.workspaceId || undefined,
          projectId:
            routeScope(key, String(requested.scope)) === 'project'
              ? requested.project || undefined
              : undefined,
          route: key,
          recordId: requested.recordProvided ? requested.record : undefined,
          shellOnly: true,
        },
        url,
        req,
      )
      let data = envelope as Row
      const scopeDenied = data.ok === false
      if (scopeDenied) {
        // The denied request supplies no UI data. Recover only chrome that this
        // actor can independently read; never project the requested record.
        const recovery = (await ctx.call(
          'flow.workspace.bootstrap',
          { companyId: scope.company, route: 'my-work', shellOnly: true },
          url,
          req,
        )) as Row
        if (recovery.ok === false) return text('Forbidden', { status: 403 })
        data = { ...recovery, problem: { code: 'forbidden' } }
      }
      const chrome = flowShellData(data)
      const context = chrome.context as Row
      const record = workspaceRecordTarget(
        key,
        requested.record as string | undefined,
        Boolean(requested.recordProvided),
        requested.workspaceId as string,
      )
      const props = {
        ...requested,
        chrome,
        workspaceId: scopeDenied
          ? requested.workspaceId || context.workspaceId
          : (context.workspaceId ?? requested.workspaceId),
        project:
          context.projectId ??
          (routeScope(key, String(requested.scope)) === 'project' ? requested.project : ''),
        ...(record !== null ? { record, recordProvided: true } : {}),
      }
      const styles = await ctx.styles(req)
      // No asynchronous work after changing the locale: the pure SSR pass is atomic.
      setFlowLocale(lang)
      const island = renderIsland('flow.workspace', view, props, {
        tag: 'div',
        key: ['companyId', 'workspaceId'],
      })
      const shell = view(props, { initialShellData: chrome })
      const imports: Record<string, string> = {
        '@ketvietlab/ketjs-view': '/_ket/view/index.js',
        '@ketvietlab/ketjs-view/jsx-runtime': '/_ket/view/jsx-runtime.js',
        '@ketvietlab/ketjs': `${base}vendor/ketjs-i18n.mjs`,
        '@ketvietlab/flow-client': `${base}workspace.mjs`,
        '@ketvietlab/flow-client/api': `${base}api.mjs`,
        '@ketvietlab/flow-client/': base,
        '@ketvietlab/design-system/date-picker': `${base}vendor/date-picker.mjs`,
        '@ketvietlab/design-system/date-picker/runtime': `${base}vendor/date-picker-runtime.mjs`,
        '@ketvietlab/flow-ui': `${base}workspace.browser.mjs`,
        '@ketvietlab/flow-ui/documents': `${ui}documents.mjs`,
        '@ketvietlab/flow-ui/workspace': `${base}workspace.browser.mjs`,
        '@ketvietlab/flow-ui/runtime': `${base}workspace.browser.mjs`,
        '@ketvietlab/flow-ui/i18n': `${ui}i18n.mjs`,
        '@ketvietlab/flow-ui/': ui,
        ...options.imports,
        [`${base}messages.mjs`]: `/flow/_messages/client?locale=${lang}`,
        [`${ui}messages.mjs`]: `/flow/_messages/ui?locale=${lang}`,
      }
      for (const [moduleUrl, catalogue] of Object.entries(options.messageImports ?? {})) {
        if (!Object.hasOwn(catalogues, catalogue)) throw new Error('Unknown Flow message catalogue')
        imports[moduleUrl] = `/flow/_messages/${catalogue}?locale=${lang}`
      }
      try {
        const response = navigablePage(req, {
          title: 'Flow',
          // A fragment is a successful representation of the denied state.
          // Direct navigation still exposes the correct authorization status.
          status: scopeDenied && !isNavigationRequest(req) ? 403 : 200,
          slots: shell.fragmentSlots(trustedMarkup(island)),
          document: () =>
            document({
              lang,
              title: 'Flow',
              head: html`${styles}<link rel="stylesheet" href=${`${base}brand/brand.css`}><link rel="icon" href=${`${base}brand/logo-flow-light-160.png`}>${trustedMarkup('<script type="importmap">' + scriptJSON({ imports }) + '</script>')}`,
              // Byte compression precedes KetJS's HTTP sender. Declare its
              // published bootstrap explicitly; compressed bytes cannot be
              // inspected by the sender's automatic string-HTML injection.
              body: html`${shell.shellView(trustedMarkup(island))}<script type="module" src="/_ket/islands.js"></script>`,
            }),
        })
        return compressFlowDocument(
          req,
          withHeaders(response, { 'cache-control': 'no-store', vary: 'X-Ket-Navigation' }),
        )
      } finally {
        shell.dispose()
      }
    }
  const messages: RouteEntry = () => async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const key = url.pathname.split('/').at(-1)!
    if (!Object.hasOwn(catalogues, key)) return text('Not found', { status: 404 })
    const locale = normalizeFlowLocale(url.searchParams.get('locale'))
    const catalogue = await import(catalogues[key as keyof typeof catalogues].href)
    const body = Object.entries(catalogue)
      .map(
        ([name, value]) =>
          `export const ${name} = ${scriptJSON(value && typeof value === 'object' && locale in value ? { [locale]: (value as Row)[locale] } : value)};`,
      )
      .join('\n')
    return compressFlowDocument(
      req,
      withHeaders(text(body, { type: 'text/javascript' }), {
        'cache-control': 'public, max-age=3600',
        vary: 'Accept-Encoding',
      }),
    )
  }
  const uploads: RouteEntry = (ctx: ServeContext) => async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.requestIdentityOf(url, req))) return text('Forbidden', { status: 403 })
    if (req.headers.origin && new URL(String(req.headers.origin)).host !== String(req.headers.host))
      return text('Forbidden', { status: 403 })
    const taskId = url.searchParams.get('task') ?? ''
    const projectId = url.searchParams.get('project') ?? ''
    if (!!taskId === !!projectId) return text('Choose one upload owner', { status: 400 })
    if (taskId) {
      const detail = (await ctx.call('flow.issue.detail', { id: taskId }, url, req)) as Row
      if (!detail?.task || detail.ok === false) return text('Forbidden', { status: 403 })
    }
    const attachment = await receiveAttachment(ctx, url, req, {
      public: false,
      maxBytes: 25 * 1024 * 1024,
      staged: {
        key: flowUploadKey,
        validate: async (body, _type, size) => {
          let actual = 0
          for await (const chunk of body) {
            actual += chunk.byteLength
            if (actual > 25 * 1024 * 1024) throw new Error('Upload exceeds limit')
          }
          if (actual !== size) throw new Error('Upload size changed')
        },
        prepare: (metadata) =>
          ctx.callUnchecked(
            'flow.attachment.prepare',
            { ...metadata, ...(taskId ? { taskId } : { projectId }), idempotencyKey: metadata.id },
            url,
            req,
          ),
        complete: async (id) =>
          (await ctx.callUnchecked('flow.attachment.complete', { id }, url, req)) as unknown as Awaited<
            ReturnType<typeof receiveAttachment>
          >,
      },
    })
    return json({ ok: true, uploadId: attachment.id }, { status: 201 })
  }
  const file: RouteEntry = (ctx: ServeContext) => async (url, req, params) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET', { status: 405 })
    let attachment: Row
    try {
      attachment = (await ctx.callUnchecked('flow.attachment.read', { id: params.id }, url, req)) as Row
    } catch {
      return text('Forbidden', { status: 403 })
    }
    const stored = await (await ctx.storageOf(url, req)).get(String(attachment.storeKey))
    if (!stored) return text('Not found', { status: 404 })
    const inline = inlineTypes.has(String(attachment.mimetype))
    const headers = {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-length': String(stored.meta.size),
      'content-disposition':
        (inline ? 'inline' : 'attachment') +
        "; filename*=UTF-8''" +
        encodeURIComponent(String(attachment.name)),
    }
    return withHeaders(
      req.method === 'HEAD'
        ? text('')
        : streamed(stored.body, { type: inline ? String(attachment.mimetype) : 'application/octet-stream' }),
      headers,
    )
  }
  return defineModule({
    name: 'flow_workspace',
    version: '1.0.0',
    depends: ['flow', 'livedoc'],
    assets: new URL('.', import.meta.resolve('@ketvietlab/flow-client')),
    messages: {
      en: { 'menu.app': 'Flow' },
      vi: { 'menu.app': 'Flow' },
      ja: { 'menu.app': 'Flow' },
    },
    menus: {
      flow: {
        label: 'flow_workspace.menu.app',
        icon: 'git-branch',
        path: '/flow/my-work',
        sequence: 45,
        needs: 'flow.workspace.bootstrap',
      },
    },
    routes: {
      '/flow/': screen,
      '/flow/context': selectFlowContext,
      '/flow/{screen}': screen,
      '/flow/_messages/{catalogue}': messages,
      '/flow/uploads': uploads,
      '/flow/files/{id}': file,
      ...documentRoutes(flowDocumentOwner(true), '/flow/live/pages'),
      ...documentRoutes(flowDocumentOwner(false), '/flow/live/issues'),
    },
    islands: {
      'flow.workspace': defineIsland<FlowWorkspaceProps>()({
        key: ['companyId', 'workspaceId'],
        props: {
          companyId: 'text',
          workspaceId: 'text',
          basePath: 'text',
          screen: 'text',
          project: 'text?',
          record: 'text?',
          recordProvided: 'bool?',
          scope: 'text?',
          background: 'text?',
          query: 'text?',
          status: 'text?',
          view: 'text?',
          group: 'text?',
          lang: 'text?',
          serverShell: 'bool?',
          chrome: 'json',
        },
        client: options.client ?? 'workspace.browser.mjs',
        export: options.export ?? 'createProductionWorkspace',
        view,
      }),
    },
    behaviors: {
      navigation: {
        client: 'navigation-host.mjs',
        export: 'attachFlowNavigation',
        when: '[data-flow="shell"]',
      },
    },
    permissions: {
      posture: 'projection/bridge',
      owner: 'flow_workspace',
      bundles: {},
      functions: {},
      exemptions: {},
    },
  })
}
