import { defineFormSchema, json, localDateTimeToUtc, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { formRefusal, readForm } from '../../backend/forms.ts'
import { timezoneOf } from '../../backend/screen.ts'

export const ruleFormSchema = defineFormSchema({
  fields: {
    id: { type: 'text', required: true },
    pricelistId: { type: 'text', required: true },
    appliedOn: { type: 'text', required: true },
    computePrice: { type: 'text', required: true },
    minQuantity: { type: 'decimal', min: 0 },
    priceRound: { type: 'decimal', min: 0 },
  },
  unknown: 'drop',
})

/** The native date-time control uses the current company/viewer timezone, never the browser's. */
export const pricelistRuleCommand =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('pricing.savePricelistItem', url, req))) return text('Forbidden', { status: 403 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).host !== req.headers.host)
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const form = await readForm(req)
    const refusal = formRefusal(ctx.translate(ctx.localeOf(url, req)))
    refusal.check(ruleFormSchema, form)
    if (refusal.refused())
      return json({
        ok: true,
        value: {
          ok: false,
          errors: Object.keys(ruleFormSchema.fields).flatMap((field) =>
            refusal.error(field) ? [{ field, message: refusal.error(field) }] : [],
          ),
        },
      })
    const input: Record<string, unknown> = { ...form }
    input.base = form.base || 'list_price'
    const timezone = await timezoneOf(ctx, url, req)
    for (const key of ['dateStart', 'dateEnd']) {
      try {
        input[key] = form[key] ? localDateTimeToUtc(form[key]!, timezone) : null
      } catch {
        return json({
          ok: true,
          value: {
            ok: false,
            errors: [
              {
                field: key,
                message: ctx.translate(ctx.localeOf(url, req))('pricing_backend.packaging.invalidDate'),
              },
            ],
          },
        })
      }
    }
    for (const key of ['categoryId', 'templateId', 'productId', 'uomId', 'basePricelistId'])
      input[key] = form[key] || null
    return json({ ok: true, value: await ctx.call('pricing.savePricelistItem', input, url, req) })
  }

/** Grid dates are company-local dates; function/domain inputs are UTC instants. */
export const pricelistRecordCommand =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('pricing.savePricelist', url, req))) return text('Forbidden', { status: 403 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).origin !== url.origin)
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const form = await readForm(req)
    const input: Record<string, unknown> = {
      id: form.id,
      name: form.name,
      sequence: Number(form.sequence || 16),
      active: form.active === 'true' || form.active === '1',
    }
    const _ = ctx.translate(ctx.localeOf(url, req))
    if (form.items !== undefined) {
      if (!(await ctx.allows('pricing.savePricelistItem', url, req)))
        return text('Forbidden', { status: 403 })
      let items: Record<string, unknown>[]
      try {
        items = JSON.parse(form.items)
        if (!Array.isArray(items)) throw new Error('items')
      } catch {
        return json({
          ok: true,
          value: { ok: false, errors: [{ field: 'items', messageKey: 'pricing.error.items' }] },
        })
      }
      const timezone = await timezoneOf(ctx, url, req)
      try {
        for (const item of items)
          for (const key of ['dateStart', 'dateEnd'])
            item[key] = item[key]
              ? localDateTimeToUtc(
                  String(item[key]).length === 10 ? String(item[key]) + 'T00:00' : String(item[key]),
                  timezone,
                )
              : null
      } catch {
        return json({
          ok: true,
          value: {
            ok: false,
            errors: [{ field: 'items', message: _('pricing_backend.packaging.invalidDate') }],
          },
        })
      }
      input.items = items
      input.expectedRevision = form.expectedRevision
    }
    const result = (await ctx.call('pricing.savePricelist', input, url, req)) as Record<string, unknown>
    if (Array.isArray(result.errors))
      result.errors = result.errors.map((error: Record<string, unknown>) => {
        const params = error.params as Record<string, unknown> | undefined
        if (!params?.line) return error
        const reason =
          typeof error.messageKey === 'string'
            ? _(error.messageKey)
            : typeof error.code === 'string'
              ? _(error.code)
              : String(error.message ?? '')
        // The worded message replaces the key: a record page words a known key itself, without the row.
        const { messageKey: _key, code: _code, ...rest } = error
        return { ...rest, message: _('pricing_backend.ruleError', { line: String(params.line), reason }) }
      })
    return json({ ok: true, value: result })
  }
