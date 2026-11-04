import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { backendPage, shell } from '../../../ui/index.ts'
import { adminPage, frameOf, inLocale } from '../../backend/screen.ts'
import { readForm, seeOther, formRefusal } from '../../backend/forms.ts'
import { orderpointFormSchema } from '../../stock/functions/orderpoints.ts'
import { loadStockConfigurationContext } from '../modal/configuration-context.ts'
import { replenishmentCollectionScreen } from './replenishment-collection.tsx'

const post = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return text('Forbidden', { status: 403 })
  const form = await readForm(req)
  if (!(await ctx.allows('stock.saveOrderpoint', url, req))) return text('Forbidden', { status: 403 })
  const _ = ctx.translate(ctx.localeOf(url, req))
  const refusal = formRefusal(_)
  const normalized = refusal.check(orderpointFormSchema, form)
  const result = normalized
    ? ((await ctx.call(
        'stock.saveOrderpoint',
        {
          id: randomUUID(),
          productId: form.productId ?? '',
          warehouseId: form.warehouseId ?? '',
          locationId: form.locationId ?? '',
          trigger: form.trigger || 'auto',
          minQuantity: form.minQuantity || '0',
          maxQuantity: form.maxQuantity || '0',
          replenishmentUomId: form.replenishmentUomId || null,
          routeId: form.routeId || null,
          ...(form.source
            ? {
                source: form.source,
                vendorId: form.vendorId || null,
                leadDays: form.leadDays ? Number(form.leadDays) : null,
              }
            : {}),
        },
        url,
        req,
      )) as Row)
    : { ok: false }
  if (result.ok) return seeOther(inLocale(url, '/admin/stock/replenishment'))
  const loaded = await loadStockConfigurationContext(ctx, url, req, { kind: 'replenishment', id: 'new' })
  if (!('data' in loaded)) return loaded
  const fieldErrors: Record<string, string> = {}
  for (const key of Object.keys(orderpointFormSchema.fields)) {
    const message = refusal.error(key)
    if (message) fieldErrors[key] = message
  }
  const sentences = refusal.sentences()
  for (const issue of (result.errors ?? []) as Row[]) {
    const message = issue.messageKey ? _(String(issue.messageKey)) : String(issue.message ?? issue.code ?? '')
    if (issue.field) fieldErrors[String(issue.field)] = message
    else sentences.push(message)
  }
  const envelope = { ...loaded, data: { ...loaded.data, record: form, fieldErrors, refusal: sentences } }
  return { ...(await renderRecord(ctx, url, req, 'new', envelope)), status: 422 }
}
export const replenishmentCollectionRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method === 'POST') return post(ctx, url, req)
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    if (!(await ctx.allows('stock.getOrderpointCollection', url, req)))
      return text('Forbidden', { status: 403 })
    const create = await ctx.allows('stock.saveOrderpoint', url, req)
    return adminPage(ctx, url, req, {
      title: 'stock_backend.replenishment',
      body: (_, frame) => replenishmentCollectionScreen(_, frame, url, create),
    })
  }

export const replenishmentRecordRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'POST' && (!params.id || params.id === 'new')) return post(ctx, url, req)
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const id = params.id ?? 'new',
      creating = id === 'new'
    if (!(await ctx.allows(creating ? 'stock.saveOrderpoint' : 'stock.listOrderpoints', url, req)))
      return text('Forbidden', { status: 403 })
    if (
      !creating &&
      !((await ctx.call('stock.listOrderpoints', {}, url, req)) as Row[]).some((point) => point.id === id)
    )
      return text('Not found', { status: 404 })
    return renderRecord(ctx, url, req, id)
  }

const renderRecord = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  envelope?: unknown,
) => {
  const lang = ctx.localeOf(url, req),
    _ = ctx.translate(lang)
  const title = _('stock_backend.replenishment.title')
  const island = await ctx.joint(url, req, 'stock_backend:replenishment.page', {
    id,
    ...(envelope ? { envelope } : {}),
    title,
    loading: _('backend.relation.loading'),
    back: inLocale(url, '/admin/stock/replenishment'),
    width: 'wide',
  })
  const frame = await frameOf(ctx, url, req)
  return backendPage(ctx, req, {
    lang,
    title,
    // biome-ignore lint/complexity/noUselessFragments: The shell needs a JSX TemplateResult, not the joint Markup.
    body: shell(_, title, <>{island}</>, {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.replenishment.help') } }
        : {}),
    }),
  })
}
