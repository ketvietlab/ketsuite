import type { Ctx, Row } from '@ketvietlab/ketjs'
import { convertQty, type Unit } from '../uom/convert.ts'
import { lotAvailable } from './lot-policy.ts'
import { ours } from './scope.ts'

export type SupplyOption = { partnerId: string; name: string; delay: number }
/** A draft that brings goods once it is confirmed and has no stock move yet: a manufacturing order. */
export type PlannedSupply = {
  id: string
  name: string
  productId: string
  /** Where the goods will arrive. */
  locationId: string
  /** In the product's own unit. */
  quantity: number
  date: string | null
  /** The draft's own page, unlocalized. */
  href: string
}
/** Optional composition boundary: Stock never reads Manufacturing models on its own. */
export type MakeReplenishment = {
  effects: readonly string[]
  planned(ctx: Ctx, filter: { productId?: unknown }): Promise<PlannedSupply[]>
  /** Whether the product can be made: it has a BOM in use. */
  makes(ctx: Ctx, productId: unknown): Promise<boolean>
  /** Drafts an order for `quantity` of the product's own unit into the location; the same id is the same order. */
  make(
    ctx: Ctx,
    input: {
      id: string
      productId: unknown
      quantity: number
      locationId: unknown
      warehouseId: unknown
      orderpointId: string
      origin: string
      at: string
      leadDays: number
    },
  ): Promise<{ id: string; name: string; href: string } | null>
}
/** Optional composition boundary: Stock never reads Purchase models on its own. */
export type SupplierReplenishment = {
  effects: readonly string[]
  /** Commerce also makes goods: a rule may draft manufacturing orders (P12). */
  make?: MakeReplenishment
  options(ctx: Ctx, productId: unknown, at: string): Promise<SupplyOption[]>
  select(
    ctx: Ctx,
    input: { productId: unknown; quantity: number; uomId: unknown; at: string; partnerId?: unknown },
  ): Promise<SupplyOption | null>
}
export const refuseReplenishment = (field: string, code: string) => ({
  ok: false as const,
  errors: [{ field, code: `stock.error.replenishment.${code}` }],
})
export class ReplenishmentRefused extends Error {
  readonly result: ReturnType<typeof refuseReplenishment>
  constructor(field: string, code: string) {
    super(code)
    this.result = refuseReplenishment(field, code)
  }
}
export const replenishmentReads = [
  'read:stock.Orderpoint',
  'read:stock.Warehouse',
  'read:stock.Location',
  'read:stock.Quant',
  'read:stock.Lot',
  'read:stock.Move',
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
]
export async function pointProduct(ctx: Ctx, point: Row) {
  const product = (await ctx.db.select('product.Product', { id: point.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (
    !product ||
    !template?.uomId ||
    product.active === false ||
    template.active === false ||
    template.type === 'combo' ||
    (point.source === 'supplier' && template.isStorable !== true)
  )
    throw new ReplenishmentRefused('productId', 'product')
  return { product, template }
}

export async function supplyFor(
  ctx: Ctx,
  point: Row,
  provider: SupplierReplenishment | undefined,
  at: string,
) {
  const supplier = point.source === 'supplier'
  const options = supplier && provider ? await provider.options(ctx, point.productId, at) : []
  const selected = point.vendorId ? options.find((option) => option.partnerId === point.vendorId) : options[0]
  if (supplier && (!provider || (point.vendorId && !selected)))
    throw new ReplenishmentRefused('vendorId', 'vendor')
  // Legacy route rows keep their unbounded forecast until an explicit horizon is configured.
  const days = point.leadDays == null ? (supplier ? selected?.delay : 0) : Number(point.leadDays)
  if (days == null || !Number.isInteger(days) || days < 0 || days > 365)
    throw new ReplenishmentRefused('leadDays', 'lead')
  return { options, selected: selected ?? null, leadDays: days }
}

export async function planOrderpoint(
  ctx: Ctx,
  point: Row,
  provider?: SupplierReplenishment,
  at = new Date().toISOString(),
) {
  const { template } = await pointProduct(ctx, point)
  const supply = await supplyFor(ctx, point, provider, at)
  const base = (await ctx.db.select('uom.Unit', { id: template.uomId }))[0]
  const unit = (await ctx.db.select('uom.Unit', { id: point.replenishmentUomId ?? template.uomId }))[0]
  if (!base || !unit) throw new ReplenishmentRefused('replenishmentUomId', 'unit')
  try {
    convertQty(1, base as unknown as Unit, unit as unknown as Unit)
  } catch {
    throw new ReplenishmentRefused('replenishmentUomId', 'unit')
  }
  const horizon = new Date(new Date(at).getTime() + supply.leadDays * 86_400_000).toISOString()
  const [quants, lots, moves, pickings] = await Promise.all([
    ours(ctx, 'stock.Quant', { productId: point.productId, locationId: point.locationId }),
    ours(ctx, 'stock.Lot', { productId: point.productId }),
    ours(ctx, 'stock.Move', { productId: point.productId }),
    ours(ctx, 'stock.Picking'),
  ])
  const lotMap = new Map(lots.map((row) => [row.id, row]))
  const pickingMap = new Map(pickings.map((row) => [row.id, row]))
  const onHand = quants
    .filter((row) => !row.lotId || lotAvailable(lotMap.get(row.lotId), new Date(at).getTime()))
    .reduce((sum, row) => sum + Number(row.quantity), 0)
  let incoming = 0,
    outgoing = 0,
    onOrder = 0
  for (const move of moves) {
    if (['done', 'cancel'].includes(String(move.state))) continue
    const picking = pickingMap.get(move.pickingId)
    const quantity = Number(move.productUomQty)
    const enters = move.locationDestId === point.locationId && move.locationId !== point.locationId
    const leaves = move.locationId === point.locationId && move.locationDestId !== point.locationId
    if (move.state === 'draft') {
      // Every draft receipt is already on order, including receipts created outside this screen.
      if (enters && picking?.state === 'draft') onOrder += quantity
      continue
    }
    if (
      (point.source === 'supplier' || point.leadDays != null) &&
      picking?.scheduledDate &&
      String(picking.scheduledDate) > horizon
    )
      continue
    if (enters) incoming += quantity
    if (leaves) outgoing += quantity // Reservations are not completed deliveries.
  }
  // A draft manufacturing order is on order as a draft receipt is.
  if (provider?.make)
    for (const draft of await provider.make.planned(ctx, { productId: point.productId }))
      if (draft.locationId === point.locationId) onOrder += draft.quantity
  const forecasted = onHand + incoming - outgoing
  const wanted = Number(point.maxQuantity) - forecasted - onOrder
  const raw = (wanted * Number(base.absoluteFactor)) / Number(unit.absoluteFactor)
  const rounding = Math.max(Number(unit.rounding) || 0.001, 1e-12)
  const quantity =
    point.active !== false && forecasted + onOrder < Number(point.minQuantity) && wanted > 0
      ? Math.ceil(raw / rounding - 1e-12) * rounding
      : 0
  // Left to the product, the supplier is the one the order would go to: the first whose minimum
  // the quantity reaches (P49). The look-ahead stays the first supplier's, as the rule reads it
  // before it knows the quantity (P50).
  const chosen =
    point.source === 'supplier' && !point.vendorId && provider && quantity > 0
      ? await provider.select(ctx, { productId: point.productId, quantity, uomId: unit.id, at })
      : null
  return {
    ...supply,
    selected: chosen ?? supply.selected,
    horizon,
    onHand,
    incoming,
    outgoing,
    onOrder,
    forecasted,
    quantity,
    uomId: String(unit.id),
    uomName: String(unit.name),
    baseUomId: String(base.id),
    baseQuantity: convertQty(quantity, unit as unknown as Unit, base as unknown as Unit),
  }
}

/** A plan that orders `baseQuantity` of the product's own unit, rounded up in the rule's ordering unit. */
export async function fixedPlan(
  ctx: Ctx,
  plan: Awaited<ReturnType<typeof planOrderpoint>>,
  baseQuantity: number,
) {
  const base = (await ctx.db.select('uom.Unit', { id: plan.baseUomId }))[0] as unknown as Unit
  const unit = (await ctx.db.select('uom.Unit', { id: plan.uomId }))[0] as unknown as Unit
  const rounding = Math.max(Number(unit.rounding) || 0.001, 1e-12)
  const quantity = Math.ceil(convertQty(baseQuantity, base, unit) / rounding - 1e-12) * rounding
  return { ...plan, quantity, baseQuantity: convertQty(quantity, unit, base) }
}
