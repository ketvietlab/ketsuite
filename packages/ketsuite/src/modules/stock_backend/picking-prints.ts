import type { ServeContext } from '@ketvietlab/ketjs'
import type { Req } from '../backend/screen.ts'
import { PICKING_PRINTS } from '../stock/reports.ts'

/** Where an operation's printed copy opens, keeping the page's language, company and branch. */
export function pickingPrintHref(url: URL, id: string, valued: boolean): string {
  const query = new URLSearchParams()
  for (const key of ['lang', 'company', 'branch'])
    if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key)!)
  if (valued) query.set('values', '1')
  const search = query.size ? `?${query}` : ''
  return `/admin/stock/transfers/${encodeURIComponent(id)}/print${search}`
}

/**
 * The printed copies an operation offers its reader (K65), the plain one first.
 *
 * Each copy is offered only to who may call the function that reads it, so the copy with values
 * reaches only who holds the stock valuation grant. That copy waits for the operation to be done:
 * before then no value has been booked to print.
 */
export async function pickingPrints(
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  code: unknown,
  state: unknown,
): Promise<Array<{ label: string; href: string }>> {
  const prints = PICKING_PRINTS[String(code)]
  if (!prints) return []
  const _ = ctx.translate(ctx.localeOf(url, req))
  // An operation offers only its own voucher, so the buttons need not repeat its title.
  const offered = [
    { print: prints.plain, valued: false, label: 'stock_backend.print.plain' },
    ...(state === 'done'
      ? [{ print: prints.valued, valued: true, label: 'stock_backend.print.valued' }]
      : []),
  ]
  const out: Array<{ label: string; href: string }> = []
  for (const { print, valued, label } of offered)
    if (await ctx.allows(print.source, url, req))
      out.push({ label: _(label), href: pickingPrintHref(url, id, valued) })
  return out
}
