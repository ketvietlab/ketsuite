import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm } from '../../backend/forms.ts'

type Issue = {
  field?: string
  code?: string
  messageKey?: string
  message?: string
  params?: { line?: number }
}

/**
 * One save for a draft BOM: its settings and both grids go to `manufacturing.saveBom` together,
 * so a refused row leaves every row unsaved. A refusal that names a row is worded with the grid
 * and the row number, since a grid cell has no field of its own on the page.
 */
export const bomRecordCommand =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!(await ctx.allows('manufacturing.saveBom', url, req))) return text('Forbidden', { status: 403 })
    if (req.headers.origin) {
      try {
        if (new URL(String(req.headers.origin)).origin !== url.origin)
          return text('Forbidden', { status: 403 })
      } catch {
        return text('Forbidden', { status: 403 })
      }
    }
    const form = await readForm(req)
    const _ = ctx.translate(ctx.localeOf(url, req))
    const parsed = (name: 'lines' | 'operations') => {
      try {
        const rows = JSON.parse(form[name] || '[]')
        return Array.isArray(rows) ? rows : null
      } catch {
        return null
      }
    }
    const lines = parsed('lines')
    const operations = parsed('operations')
    if (!lines || !operations)
      return json({
        ok: true,
        value: { ok: false, errors: [{ field: 'lines', messageKey: 'manufacturing.error.invalid' }] },
      })
    const result = (await ctx.call(
      'manufacturing.saveBom',
      {
        id: form.id,
        code: form.code ?? '',
        productId: form.productId,
        productQty: form.productQty,
        productUomId: form.productUomId,
        consumption: form.consumption || null,
        unitWeight: form.unitWeight ?? '',
        weightTolerance: form.weightTolerance ?? '',
        phMin: form.phMin ?? '',
        phMax: form.phMax ?? '',
        // The checkbox posts a value only when ticked.
        toOrder: Boolean(form.toOrder) && form.toOrder !== 'false',
        lines,
        operations,
      },
      url,
      req,
    )) as { ok: boolean; errors?: Issue[] }
    if (Array.isArray(result.errors))
      result.errors = result.errors.map((error) => {
        const line = error.params?.line
        if (!line) return error
        const reason = _(String(error.messageKey ?? error.code ?? 'manufacturing.error.invalid'))
        const grid = String(error.field ?? '').startsWith('operations') ? 'operations' : 'lines'
        return {
          field: grid,
          message: _('manufacturing_backend.bom.rowError', {
            grid: _(`manufacturing_backend.bom.${grid}`),
            line: String(line),
            reason,
          }),
        }
      })
    return json({ ok: true, value: result })
  }
