import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'

export const orderWorkflowFunction = async (
  ctx: ServeContext,
  req: Parameters<Route>[1],
  action: 'confirmOrder' | 'cancelOrder',
) => {
  const functions = (await ctx.live(req)).functions
  // The Commerce factory owns the ledger in the native Sale transaction and
  // retains Sale's narrower confirm/cancel grants.
  if (functions[`sale.${action}`]?.effects?.includes('read:loyalty.Application')) return `sale.${action}`
  return functions[`loyalty_sale.${action}`] ? `loyalty_sale.${action}` : `sale.${action}`
}

/** Preserve the deployment's loyalty composition on both native record presentations. */
export const saleOrderCommand =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).host !== String(req.headers.host))
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const form = await readForm(req)
    if (form.command !== 'confirmOrder' && form.command !== 'cancelOrder')
      return text('Unknown command', { status: 400 })
    const fn = await orderWorkflowFunction(ctx, req, form.command)
    if (!(await ctx.allows(fn, url, req))) return text('Forbidden', { status: 403 })
    const input = {
      id: form.id,
      ...(form.expectedRevision ? { expectedRevision: Number(form.expectedRevision) } : {}),
    }
    const value = (await ctx.call(fn, input, url, req)) as Row
    if (value.ok === false && Array.isArray(value.errors))
      value.errors = value.errors.map((error: Row) =>
        error.field === 'expectedRevision' && error.message === 'sales order changed'
          ? { field: error.field, code: 'sale.error.orderChanged' }
          : error,
      )
    return json({ ok: true, value })
  }
