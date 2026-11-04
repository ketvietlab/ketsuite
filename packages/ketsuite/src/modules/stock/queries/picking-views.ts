import { eq, from, inArray } from '@ketvietlab/ketjs'
import { withoutCosts } from '../valuation.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { company } from '../scope.ts'

export const pickingViewEffects = [
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Warehouse',
  'read:stock.Location',
  'read:stock.Move',
  'read:stock.MoveLine',
  'read:stock.Lot',
  'read:product.Product',
  'read:product.Template',
]

export const rowsBy = (rows: Row[], key: string): Map<string, Row[]> => {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const id = String(row[key])
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

export /**
 * Load the transfer aggregate and the stock-owned labels around it in batches.
 *
 * Staff and backend clients need the same picking/type/location/move graph. Keeping
 * the joins here prevents every facade from growing an N+1 query per transfer.
 * Product display names and company labels stay with their owning modules.
 */
const pickingViews = async (ctx: Ctx, pickings: Row[]): Promise<Row[]> => {
  if (!pickings.length) return []
  const pickingIds = pickings.map((row) => String(row.id))
  const pickingTypeIds = [...new Set(pickings.map((row) => String(row.pickingTypeId)))]
  const locationIds = [
    ...new Set(pickings.flatMap((row) => [String(row.locationId), String(row.locationDestId)])),
  ]
  const PT = ctx.table('stock.PickingType')
  const L = ctx.table('stock.Location')
  const M = ctx.table('stock.Move')
  const ML = ctx.table('stock.MoveLine')
  const mine = company(ctx)
  const [pickingTypes, locations, moves, lines] = await Promise.all([
    ctx.db.all(from(PT).where(eq(PT.companyId, mine), inArray(PT.id, pickingTypeIds))),
    ctx.db.all(from(L).where(eq(L.companyId, mine), inArray(L.id, locationIds))),
    ctx.db.all(from(M).where(eq(M.companyId, mine), inArray(M.pickingId, pickingIds))),
    ctx.db.all(from(ML).where(eq(ML.companyId, mine), inArray(ML.pickingId, pickingIds))),
  ])
  const warehouseIds = [
    ...new Set(
      pickingTypes
        .map((row) => row.warehouseId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const productIds = [...new Set(moves.map((row) => String(row.productId)))]
  const lotIds = [
    ...new Set(
      lines
        .map((row) => row.lotId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const W = ctx.table('stock.Warehouse')
  const Lot = ctx.table('stock.Lot')
  const Product = ctx.table('product.Product')
  const [warehouses, lots, products] = await Promise.all([
    warehouseIds.length ? ctx.db.all(from(W).where(eq(W.companyId, mine), inArray(W.id, warehouseIds))) : [],
    lotIds.length ? ctx.db.all(from(Lot).where(eq(Lot.companyId, mine), inArray(Lot.id, lotIds))) : [],
    productIds.length ? ctx.db.all(from(Product).where(inArray(Product.id, productIds))) : [],
  ])
  const templateIds = [...new Set(products.map((row) => String(row.templateId)))]
  const Template = ctx.table('product.Template')
  const templates = templateIds.length
    ? await ctx.db.all(from(Template).where(inArray(Template.id, templateIds)))
    : []
  const byId = (rows: Row[]): Map<string, Row> => new Map(rows.map((row) => [String(row.id), row]))
  const typeById = byId(pickingTypes)
  const locationById = byId(locations)
  const warehouseById = byId(warehouses)
  const lotById = byId(lots)
  const productById = byId(products)
  const templateById = byId(templates)
  const movesByPicking = rowsBy(moves, 'pickingId')
  const linesByMove = rowsBy(lines, 'moveId')

  return pickings.map((picking) => {
    const pickingType = typeById.get(String(picking.pickingTypeId)) ?? null
    const warehouse = pickingType?.warehouseId
      ? (warehouseById.get(String(pickingType.warehouseId)) ?? null)
      : null
    return {
      ...picking,
      pickingType,
      warehouse,
      sourceLocation: locationById.get(String(picking.locationId)) ?? null,
      destinationLocation: locationById.get(String(picking.locationDestId)) ?? null,
      moves: (movesByPicking.get(String(picking.id)) ?? [])
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .map((move) => {
          const product = productById.get(String(move.productId))
          const template = product ? templateById.get(String(product.templateId)) : null
          return {
            ...withoutCosts(move),
            tracking: String(template?.tracking ?? 'none'),
            lines: (linesByMove.get(String(move.id)) ?? [])
              .sort((left, right) => String(left.id).localeCompare(String(right.id)))
              .map((line) => ({
                ...withoutCosts(line),
                lot: line.lotId ? (lotById.get(String(line.lotId)) ?? null) : null,
              })),
          }
        }),
    }
  })
}
