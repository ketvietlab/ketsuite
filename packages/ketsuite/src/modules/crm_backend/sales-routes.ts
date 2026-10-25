import type { IncomingMessage } from 'node:http'
import * as ds from '@ketvietlab/design-system'
import { json, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry } from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { marked } from 'marked'
import { shell } from '../../ui/index.ts'
import { seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import { islands } from './islands.ts'
import { runSalesCommand, salesCommandInput } from './sales/commands.ts'
import { salesHelpDrawer } from './sales/help.mjs'
import { adminSalesRoutes, salesScreenPaths } from './sales/routes.mjs'
import { salesTitle } from './sales/screens.mjs'

type SalesScreen = keyof typeof salesScreenPaths | 'lead-detail' | 'crm-team'

/** The function a reader must be allowed to call before a screen's shell is served. */
const NEEDS: Record<SalesScreen, string> = {
  pipeline: 'crm.case.list',
  cases: 'crm.case.list',
  'lead-new': 'crm.case.save',
  'lead-detail': 'crm.case.get',
  'activity-planner': 'crm.case.list',
  'crm-settings': 'crm.configuration.get',
  'crm-team': 'crm.configuration.get',
}

/**
 * A CRM sales screen: the shell, the screen's help and the `crm.sales-screen` island, which reads
 * `crm.sales.read` and draws the page whole (title, commands, controls, body and dialogs).
 */
const salesScreen =
  (screen: SalesScreen): RouteEntry =>
  (ctx): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows(NEEDS[screen], url, req))) return text('Forbidden', { status: 403 })
    const query = adminSalesRoutes.parse(url)
    if (!query || query.get('screen') !== screen) return text('Not found', { status: 404 })
    // A record opened in the list's modal before records had their own page.
    const record = screen === 'cases' ? (url.searchParams.get('record') ?? '') : ''
    if (record.startsWith('crm.case:') && record.length > 'crm.case:'.length) {
      const lang = url.searchParams.get('lang')
      return seeOther(
        adminSalesRoutes.href(
          new URLSearchParams({
            screen: 'lead-detail',
            id: record.slice('crm.case:'.length),
            ...(lang ? { lang } : {}),
          }),
        ),
      )
    }
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const title = salesTitle(screen, lang)
    const island = islands['crm.sales-screen']
    // A record the reader cannot see, or one another module keeps in the CRM's table, is not found here; the
    // island says so on the page.
    const found =
      screen !== 'lead-detail' ||
      Boolean(
        (
          (await ctx.call('crm.case.get', { id: query.get('id') }, url, req).catch(() => null)) as {
            id?: unknown
          } | null
        )?.id,
      )
    return adminPage(ctx, url, req, {
      title,
      translate: false,
      ...(found ? {} : { status: 404 }),
      body: (_, frame) =>
        shell(
          _,
          title,
          // The island's page is the content's own child, so the content pane lets an operational page
          // run to its edges as it does a page drawn on the server.
          html`${trustedMarkup(
            renderIsland(
              'crm.sales-screen',
              island.view,
              { screen, query: query.toString(), lang },
              { tag: 'div' },
            ),
          )}${salesHelpDrawer({ ds, lexer: marked.lexer, screen, lang })}`,
          {
            ...frame,
            topbar: false,
            ...(frame.applications
              ? {
                  applications: {
                    ...frame.applications,
                    helpLabel: lang === 'en' ? 'Screen help' : 'Hướng dẫn màn hình',
                  },
                }
              : {}),
          },
        ),
    })
  }

const MAX_READ_BYTES = 16 * 1024

/** A POST from another site carries the signed-in user's cookie without their intent. */
const crossSite = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown> | null> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_READ_BYTES) return null
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
const readQuery = async (req: IncomingMessage): Promise<string | null> => {
  const body = await readBody(req)
  return typeof body?.query === 'string' ? body.query : null
}

/**
 * `POST {query}` → `{ ok, value }`: the view model the island draws a screen from. The reader needs the
 * permission of the screen named in the query, the same one its page shell checks.
 */
const salesRead: RouteEntry =
  (ctx): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    const asked = await readQuery(req)
    if (asked === null) return json({ ok: false, error: 'E_INVALID' }, { status: 400 })
    // The page's language may come from the reader's locale rather than its address; the read speaks it too.
    const params = new URLSearchParams(asked)
    if (!params.has('lang') && ctx.localeOf(url, req) === 'en') params.set('lang', 'en')
    const query = params.toString()
    const screen = params.get('screen') as SalesScreen | null
    if (!screen || !Object.hasOwn(NEEDS, screen))
      return json({ ok: false, error: 'E_NOT_FOUND' }, { status: 404 })
    if (!(await ctx.allows(NEEDS[screen], url, req)))
      return json({ ok: false, error: 'E_FORBIDDEN' }, { status: 403 })
    // "Create a lead" on a customer's page names the customer: read it as the reader, so the form only starts
    // from a customer they may see.
    const partnerId = screen === 'lead-new' ? params.get('partnerId') : null
    const partner = partnerId
      ? await ctx.call('partner.getPartner', { id: partnerId }, url, req).catch(() => null)
      : null
    // Unchecked: the permission that matters was checked above; `ctx.call` would ask for a grant of this
    // internal read that no role carries. It still runs as the reader, so `caseAudience` scopes it.
    const result = (await ctx.callUnchecked(
      'crm_backend.sales.read',
      { query, ...(partner ? { partner } : {}) },
      url,
      req,
    )) as {
      model?: unknown
      status?: number | null
    }
    if (!result?.model) return json({ ok: false }, { status: result?.status ?? 500 })
    return json({ ok: true, value: result.model })
  }

/** `POST <list state>` → `{ ok, value }`: one page of the record list (the book's paged read). */
const salesSearch: RouteEntry =
  (ctx): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    if (!(await ctx.allows(NEEDS.cases, url, req)))
      return json({ ok: false, error: 'E_FORBIDDEN' }, { status: 403 })
    const input = await readBody(req)
    if (input === null) return json({ ok: false, error: 'E_INVALID' }, { status: 400 })
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'vi'
    // Unchecked for the same reason as the screen read: the list's own permission was checked above.
    const result = (await ctx.callUnchecked('crm_backend.sales.search', { input, lang }, url, req)) as {
      result?: unknown
      status?: number | null
    }
    if (!result?.result) return json({ ok: false }, { status: result?.status ?? 500 })
    return json({ ok: true, value: result.result })
  }

const MAX_COMMAND_BYTES = 256 * 1024

const readCommand = async (req: IncomingMessage): Promise<string | null> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_COMMAND_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * `POST <form>`: one write of a sales screen, as the signed-in user. The island asks for the reply as
 * `{ location, response?, notice? }` (`x-crm-sales-resolve: 1`); a plain form post follows a redirect.
 */
const salesCommand: RouteEntry =
  (ctx): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    if (!String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded'))
      return text('Unsupported media type', { status: 415 })
    const body = await readCommand(req)
    if (body === null) return text('Payload too large', { status: 413 })
    const reply = await runSalesCommand(ctx, url, req, salesCommandInput(body))
    if (req.headers['x-crm-sales-resolve'] === '1')
      return withHeaders(json(reply), { 'cache-control': 'no-store' })
    return withHeaders(text('', { status: 303 }), { location: reply.location })
  }

/** `GET /admin/crm/cases/export?<list address>`: every record the list shows there, as JSON. */
const salesExport: RouteEntry =
  (ctx): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows(NEEDS.cases, url, req))) return text('Forbidden', { status: 403 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const result = (await ctx.callUnchecked(
      'crm_backend.sales.export',
      { query: url.searchParams.toString(), lang },
      url,
      req,
    )) as { scope?: unknown; total?: number; rows?: unknown; status?: number | null }
    if (!result?.rows) return text('Forbidden', { status: result?.status ?? 500 })
    const day = new Date().toISOString().slice(0, 10)
    return withHeaders(json({ scope: result.scope, total: result.total, rows: result.rows }), {
      'content-disposition': `attachment; filename="crm-records-${day}.json"`,
      'cache-control': 'no-store',
    })
  }

export const salesRoutes: Record<string, RouteEntry> = {
  '/admin/crm/sales/read': salesRead,
  '/admin/crm/sales/search': salesSearch,
  '/admin/crm/sales/command': salesCommand,
  '/admin/crm/cases/export': salesExport,
  [salesScreenPaths.pipeline]: salesScreen('pipeline'),
  [salesScreenPaths.cases]: salesScreen('cases'),
  [salesScreenPaths['lead-new']]: salesScreen('lead-new'),
  '/admin/crm/cases/{id}': salesScreen('lead-detail'),
  [salesScreenPaths['activity-planner']]: salesScreen('activity-planner'),
  [salesScreenPaths['crm-settings']]: salesScreen('crm-settings'),
  '/admin/crm/configuration/teams/{id}': salesScreen('crm-team'),
}
