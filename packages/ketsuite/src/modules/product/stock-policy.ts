import { randomUUID } from 'node:crypto'
import { from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export const stockPositionEffects = ['read:stock.Quant', 'read:stock.Location']

/** Physical positions cannot be cancelled out against supplier/customer counterpart entries. */
export async function hasPhysicalStock(ctx: Ctx, productIds: string[]): Promise<boolean> {
  if (!ctx.manifest.models['stock.Quant'] || !productIds.length) return false
  const Q = ctx.table('stock.Quant')
  const L = ctx.table('stock.Location')
  const locations = await ctx.db.all(from(L).where(inArray(L.usage, ['internal', 'transit'])))
  if (!locations.length) return false
  const positions = await ctx.db.all(
    from(Q)
      .where(inArray(Q.productId, productIds))
      .where(
        inArray(
          Q.locationId,
          locations.map((location) => String(location.id)),
        ),
      ),
  )
  return positions.some((row) => Number(row.quantity) !== 0 || Number(row.reservedQuantity) !== 0)
}

/** Caller owns the transaction. Stock writers and setup/cost editors take this same row lock. */
export async function claimStockConfiguration(ctx: Ctx, template: Row): Promise<void> {
  if (!ctx.manifest.modules.stock) return
  const changed = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    { inventoryRevision: template.inventoryRevision ?? null, revisionId: template.revisionId ?? null },
    { inventoryRevision: Number(template.inventoryRevision ?? 0) + 1, revisionId: randomUUID() },
  )
  if (!('dryRun' in changed) && !changed.matched)
    throw new KetError({ code: 'conflict', message: 'Product stock changed; reload before retrying.' })
}

export const stockLocked = (fields: string[]) => ({
  ok: false,
  errors: fields.map((field) => ({ field, code: 'product.error.template.stockLocked' })),
})
