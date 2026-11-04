import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'
import { claimRevision, SaleRefused } from './shared.ts'
import { linesFunctions, replaceQuotationLines } from './lines.ts'

const refused = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `sale.error.${code}` }],
})

/** The checked set is complete; only a transition to optional resets its contained quantities. */
export async function setOptionalSections(ctx: Ctx, args: Row, inTransaction = false) {
  if (
    !Array.isArray(args.sectionIds) ||
    args.sectionIds.length > 100 ||
    args.sectionIds.some((id) => typeof id !== 'string') ||
    new Set(args.sectionIds).size !== args.sectionIds.length
  )
    return refused('sectionIds', 'gridFields')
  const selected = new Set(args.sectionIds as string[])
  try {
    const write = async (tx: Ctx) => {
      const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
      if (
        !order ||
        !['draft', 'sent'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return refused('id', 'lineNotEditable')
      if (Number(order.revision) !== Number(args.expectedRevision))
        return refused('expectedRevision', 'orderChanged')
      const lines = (await ours(tx, 'sale.OrderLine', { orderId: order.id })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
      )
      const sections = lines.filter((line) => line.displayType === 'section')
      if ([...selected].some((id) => !sections.some((line) => line.id === id)))
        return refused('sectionIds', 'gridOwnership')
      if (sections.every((line) => (line.optionalSection === true) === selected.has(String(line.id))))
        return { ok: true, id: order.id, revision: order.revision }
      if (!(await claimRevision(tx, order, args.expectedRevision)))
        throw new SaleRefused(refused('expectedRevision', 'orderChanged'))
      let reset = false
      const next = lines.map((line) => {
        if (line.displayType === 'section') {
          const optional = selected.has(String(line.id))
          reset = optional && line.optionalSection !== true
          return { ...line, optionalSection: optional }
        }
        // Combo children are reconstructed from their parent by the common writer.
        return reset && !line.displayType && !line.comboParentId && !line.loyaltyApplicationId
          ? { ...line, productUomQty: '0' }
          : line
      })
      await replaceQuotationLines(tx, order.id, next)
      const saved = (await ours(tx, 'sale.Order', { id: order.id }))[0]!
      return { ok: true, id: order.id, revision: Number(saved.revision) }
    }
    return inTransaction ? await write(ctx) : await ctx.tx(write)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}

export const setOptionalSectionsHandler = (ctx: Ctx, args: Row) => setOptionalSections(ctx, args)

export const sectionFunctions = {
  setOptionalSections: defineFn({
    input: { id: 'id', expectedRevision: 'int', sectionIds: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [...linesFunctions.addLine!.effects!, 'read:stock.Move', 'read:account.MoveLine'],
    idempotent: true,
    agent: true,
    handler: setOptionalSectionsHandler,
  }),
}
