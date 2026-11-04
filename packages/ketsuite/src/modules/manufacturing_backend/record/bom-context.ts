import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

/**
 * What a bill of materials page renders from: the version, what this reader may do with it in
 * its state, and the choices its two grids offer.
 */
export const bomContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('manufacturing.getBom', url, req))) return text('Forbidden', { status: 403 })
    const record = (await ctx.call('manufacturing.getBom', { id: params.id }, url, req)) as Row | null
    if (!record) return text('Not found', { status: 404 })
    const may = (fn: string) => ctx.allows(`manufacturing.${fn}`, url, req)
    const state = String(record.state)
    const [saveBom, submitBom, approveBom, rejectBom, newBomVersion, archiveBom] = await Promise.all(
      ['saveBom', 'submitBom', 'approveBom', 'rejectBom', 'newBomVersion', 'archiveBom'].map(may),
    )
    const productIds = [
      String(record.productId),
      ...((record.lines as Row[]) ?? []).map((line) => String(line.productId)),
    ]
    const [workCenters, units, referenced, products] = await Promise.all([
      optionalRead<Row[]>(ctx, 'manufacturing.listWorkCenters', { includeArchived: true }, url, req, []),
      optionalRead<Row[]>(ctx, 'uom.listUnits', {}, url, req, []),
      optionalRead<Row[]>(ctx, 'product.listVariants', { ids: [...new Set(productIds)] }, url, req, []),
      optionalRead<Row[]>(ctx, 'product.listVariants', { limit: 100 }, url, req, []),
    ])
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: {
        record,
        lang,
        draftId: randomUUID(),
        can: {
          save: saveBom && state === 'draft',
          submit: submitBom && state === 'draft',
          approve: approveBom && state === 'review',
          reject: rejectBom && state === 'review',
          newVersion: newBomVersion && state === 'active',
          archive: archiveBom && ['draft', 'active'].includes(state),
          products: await ctx.allows('product.listVariants', url, req),
        },
        choices: {
          // An archived center stays named on the operations that already use it.
          workCenters: workCenters.filter(
            (row) =>
              row.active !== false ||
              ((record.operations as Row[]) ?? []).some((operation) => operation.workCenterId === row.id),
          ),
          units,
          products: [...referenced, ...products].filter(
            (row, index, all) => all.findIndex((other) => other.id === row.id) === index,
          ),
        },
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('manufacturing_backend.') || key.startsWith('manufacturing.error.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
