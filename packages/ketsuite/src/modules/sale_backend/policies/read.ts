import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'
import { fold } from '../../product/text-fold.ts'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { POLICY_PATH, POLICY_SETTINGS, policyHref, policyQuery } from './shared.ts'
import type { PolicyAnswer, PolicyModalData, PolicyRow, PolicySetting } from './shared.ts'

const str = (value: unknown) => String(value ?? '')
const setting = (value: unknown): PolicySetting =>
  POLICY_SETTINGS.includes(value as never) ? (value as PolicySetting) : 'default'

export function policyAnswer(products: Row[], args: Row): PolicyAnswer {
  const requested = new URL(str(args.href) || POLICY_PATH, 'http://ket.local')
  if (typeof args.q === 'string') requested.searchParams.set('q', args.q)
  if (args.page != null) requested.searchParams.set('page', String(args.page))
  const query = policyQuery(requested, Number(args.pageSize) || undefined)
  const url = new URL(query.href, 'http://ket.local')
  // A product is found by its code, name or category.
  const matched = products.filter((row) =>
    [row.defaultCode, row.name, row.categoryName].some((value) => fold(str(value)).includes(fold(query.q))),
  )
  const counts = {
    all: matched.length,
    ...Object.fromEntries(
      POLICY_SETTINGS.map((key) => [key, matched.filter((row) => setting(row.setting) === key).length]),
    ),
  } as PolicyAnswer['counts']
  const wanted = url.searchParams.get('setting')
  const rows = matched
    .filter((row) => !POLICY_SETTINGS.includes(wanted as never) || setting(row.setting) === wanted)
    .map(
      (row): PolicyRow => ({
        id: str(row.id),
        defaultCode: str(row.defaultCode),
        name: str(row.name),
        categoryName: str(row.categoryName),
        type: str(row.type),
        policy: str(row.policy) === 'delivery' ? 'delivery' : 'order',
        setting: setting(row.setting),
        editHref: '',
      }),
    )
  // The function returns them by code; descending only reverses that order.
  if (url.searchParams.get('dir') === 'desc') rows.reverse()
  const pages = Math.max(1, Math.ceil(rows.length / query.pageSize)),
    page = Math.min(query.page, pages)
  const href = policyHref(query.href, { page: page > 1 ? String(page) : null })
  return {
    query: { ...query, page, href },
    total: rows.length,
    page,
    pages,
    counts,
    isEmpty: products.length === 0,
    rows: rows.slice((page - 1) * query.pageSize, page * query.pageSize).map((row) => ({
      ...row,
      editHref: recordModalHref(href, { kind: 'sale.invoicePolicy', id: row.id }),
    })),
    ...(page > 1 ? { previous: policyHref(href, { page: page > 2 ? String(page - 1) : null }) } : {}),
    ...(page < pages ? { next: policyHref(href, { page: String(page + 1) }) } : {}),
  }
}

export const policyRead =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('sale.listInvoicePolicies', url, req))) return text('Forbidden', { status: 403 })
    const input = await readForm(req)
    const products = (await ctx.call('sale.listInvoicePolicies', {}, url, req)) as Row[]
    return json({ ok: true, value: policyAnswer(products, input) })
  }

export const policyContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listInvoicePolicies', url, req))) return text('Forbidden', { status: 403 })
    const current = ((await ctx.call('sale.listInvoicePolicies', { ids: [params.id] }, url, req)) as Row[])[0]
    if (!current) return text('Not found', { status: 404 })
    const config = (await ctx.call('sale.getConfiguration', {}, url, req)) as Row
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const data: PolicyModalData = {
      lang,
      record: {
        id: str(current.id),
        name: str(current.name),
        defaultCode: str(current.defaultCode),
        categoryName: str(current.categoryName),
        type: str(current.type),
        invoicePolicy: str(current.invoicePolicy),
        setting: setting(current.setting),
        revisionId: str(current.revisionId),
      },
      goodsDefault: config.goodsInvoicePolicy === 'delivery' ? 'delivery' : 'order',
      permissions: { edit: await ctx.allows('sale.setInvoicePolicy', url, req) },
    }
    const manifest = await ctx.live(req)
    return json({
      data,
      messages: Object.fromEntries(
        Object.entries(manifest.messages?.[lang] ?? {}).filter(
          ([key]) =>
            key.startsWith('sale_backend.policy.') ||
            key.startsWith('sale.error.invoicePolicy.') ||
            key.startsWith('recordModal.'),
        ),
      ),
    })
  }
