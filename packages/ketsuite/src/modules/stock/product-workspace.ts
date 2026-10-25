// What the product page shows about one template's stock, read in one call.
//
// Per active warehouse of the company in scope: on hand, reserved, available, incoming,
// outgoing and forecast over its internal and transit locations, the same arithmetic as
// `forecast`; the replenishment rule (min/max) of each variant there; what each variant
// can sell now; and whether stock or moves already exist, which fixes the product's unit.
//
// `saveProductOrderpoints` is the page's write for those rules: one warehouse, every
// variant of the template in one transaction, at the warehouse's stock location.

import { randomUUID } from 'node:crypto'
import { and, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { company, ours } from './scope.ts'

const FIGURES = ['onHand', 'reserved', 'available', 'incoming', 'outgoing', 'forecasted'] as const
type Figures = Record<(typeof FIGURES)[number], number>

const zero = (): Figures => ({
  onHand: 0,
  reserved: 0,
  available: 0,
  incoming: 0,
  outgoing: 0,
  forecasted: 0,
})
const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * The location a warehouse replenishes: its stock location (`<warehouse>:stock`, which
 * `saveWarehouse` creates and its routes deliver to), else its first internal one.
 */
const stockLocations = (locations: Row[]): Map<string, string> => {
  const found = new Map<string, string>()
  const internal = locations
    .filter(
      (location) =>
        String(location.usage) === 'internal' && location.active !== false && location.warehouseId,
    )
    .sort((a, b) => String(a.parentPath).localeCompare(String(b.parentPath)))
  for (const location of internal)
    if (String(location.id) === `${String(location.warehouseId)}:stock`)
      found.set(String(location.warehouseId), String(location.id))
  for (const location of internal)
    if (!found.has(String(location.warehouseId))) found.set(String(location.warehouseId), String(location.id))
  return found
}

const rowsFor = async (ctx: Ctx, model: string, productIds: string[]): Promise<Row[]> => {
  if (!productIds.length) return []
  const table = ctx.table(model)
  return ctx.db.all(
    from(table).where(and(eq(table.companyId, company(ctx)), inArray(table.productId, productIds))),
  )
}

export const productWorkspaceFunctions: Record<string, FnSpec> = {
  productWorkspace: defineFn({
    input: { templateId: 'id' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:stock.Warehouse',
      'read:stock.Location',
      'read:stock.Quant',
      'read:stock.Move',
      'read:stock.Orderpoint',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template || !ctx.scope.company) return null
      const products = await ctx.db.select('product.Product', { templateId: args.templateId })
      const productIds = products.map((row) => String(row.id))
      const [warehouses, locations, quants, moves, orderpoints] = await Promise.all([
        ctx.db.select('stock.Warehouse', { companyId: company(ctx), active: true }),
        ctx.db.select('stock.Location', { companyId: company(ctx) }),
        rowsFor(ctx, 'stock.Quant', productIds),
        rowsFor(ctx, 'stock.Move', productIds),
        rowsFor(ctx, 'stock.Orderpoint', productIds),
      ])
      const warehouseOf = new Map(
        locations
          .filter(
            (location) => ['internal', 'transit'].includes(String(location.usage)) && location.warehouseId,
          )
          .map((location) => [String(location.id), String(location.warehouseId)]),
      )
      const figures = new Map(warehouses.map((warehouse) => [String(warehouse.id), zero()]))
      const byVariant = new Map(productIds.map((id) => [id, 0]))
      // What each variant can sell in each warehouse, against which its rule is read.
      const availableAt = new Map<string, number>()
      for (const quant of quants) {
        const warehouse = warehouseOf.get(String(quant.locationId))
        const row = warehouse ? figures.get(warehouse) : undefined
        if (!row) continue
        const onHand = Number(quant.quantity ?? 0)
        const reserved = Number(quant.reservedQuantity ?? 0)
        row.onHand += onHand
        row.reserved += reserved
        byVariant.set(
          String(quant.productId),
          (byVariant.get(String(quant.productId)) ?? 0) + onHand - reserved,
        )
        const at = `${warehouse}:${String(quant.productId)}`
        availableAt.set(at, (availableAt.get(at) ?? 0) + onHand - reserved)
      }
      for (const move of moves) {
        if (['done', 'cancel', 'draft'].includes(String(move.state))) continue
        const from = warehouseOf.get(String(move.locationId))
        const to = warehouseOf.get(String(move.locationDestId))
        if (from === to) continue
        const quantity = Number(move.productUomQty ?? 0)
        const incoming = to ? figures.get(to) : undefined
        const outgoing = from ? figures.get(from) : undefined
        if (incoming) incoming.incoming += quantity
        if (outgoing) outgoing.outgoing += quantity
      }
      const stockLocation = stockLocations(locations)
      const rows = warehouses
        .map((warehouse) => {
          const id = String(warehouse.id)
          const row = figures.get(id)!
          row.available = row.onHand - row.reserved
          row.forecasted = row.onHand + row.incoming - row.outgoing
          const rules = orderpoints.filter(
            (point) => String(point.warehouseId) === id && point.active !== false,
          )
          return {
            id,
            name: String(warehouse.name),
            code: String(warehouse.code ?? ''),
            locationId: stockLocation.get(id) ?? null,
            ...(Object.fromEntries(FIGURES.map((key) => [key, round(row[key])])) as Figures),
            orderpoints: rules.map((point) => ({
              id: String(point.id),
              productId: String(point.productId),
              locationId: String(point.locationId),
              minQuantity: Number(point.minQuantity ?? 0),
              maxQuantity: Number(point.maxQuantity ?? 0),
              available: round(availableAt.get(`${id}:${String(point.productId)}`) ?? 0),
            })),
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      const totals = Object.fromEntries(
        FIGURES.map((key) => [key, round(rows.reduce((sum, row) => sum + Number(row[key]), 0))]),
      ) as Figures
      return {
        tracked: template.isStorable === true,
        tracking: String(template.tracking ?? 'none'),
        warehouses: rows,
        totals,
        variants: Object.fromEntries([...byVariant].map(([id, value]) => [id, round(value)])),
        inUse: quants.length > 0 || moves.length > 0,
      }
    },
  }),

  /**
   * Set the minimum and maximum stock of a template's variants at one warehouse.
   *
   * `rules` holds one `{ productId, minQuantity, maxQuantity }` per variant; a variant
   * whose two quantities are empty has no rule there (an existing one is switched off).
   * Rules sit at the warehouse's stock location and replenish in the product's unit.
   */
  saveProductOrderpoints: defineFn({
    input: { templateId: 'id', warehouseId: 'id', rules: 'json' },
    output: { ok: 'bool', saved: 'int?', cleared: 'int?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:stock.Warehouse',
      'read:stock.Location',
      'read:stock.Orderpoint',
      'write:stock.Orderpoint',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const refuse = (field: string, code: string) => ({ ok: false, errors: [{ field, code }] })
      const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
      if (!template) return refuse('templateId', 'stock.error.orderpoint.product')
      if (!template.uomId) return refuse('templateId', 'stock.error.orderpoint.unit')
      const warehouse = (await ours(ctx, 'stock.Warehouse', { id: args.warehouseId }))[0]
      if (!warehouse || warehouse.active === false)
        return refuse('warehouseId', 'stock.error.orderpoint.warehouse')
      const locationId = stockLocations(
        await ours(ctx, 'stock.Location', { warehouseId: args.warehouseId }),
      ).get(String(args.warehouseId))
      if (!locationId) return refuse('warehouseId', 'stock.error.orderpoint.warehouse')
      const variants = new Set(
        (await ctx.db.select('product.Product', { templateId: args.templateId })).map((row) =>
          String(row.id),
        ),
      )
      if (!Array.isArray(args.rules) || args.rules.length > 256)
        return refuse('rules', 'stock.error.orderpoint.product')
      const quantity = (value: unknown): number | null | undefined => {
        const raw = String(value ?? '').trim()
        if (raw === '') return null
        return /^\d+(\.\d{1,3})?$/.test(raw) ? Number(raw) : undefined
      }
      const errors: Array<{ field: string; code: string }> = []
      const rules: Array<{ productId: string; min: number | null; max: number | null }> = []
      const seen = new Set<string>()
      args.rules.forEach((entry: unknown, index: number) => {
        const rule = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
        const productId = String(rule.productId ?? '')
        if (!variants.has(productId) || seen.has(productId)) {
          errors.push({ field: `rules.${index}.productId`, code: 'stock.error.orderpoint.product' })
          return
        }
        seen.add(productId)
        const min = quantity(rule.minQuantity)
        const max = quantity(rule.maxQuantity)
        if (min === undefined)
          errors.push({ field: `rules.${index}.minQuantity`, code: 'stock.error.orderpoint.quantity' })
        if (max === undefined)
          errors.push({ field: `rules.${index}.maxQuantity`, code: 'stock.error.orderpoint.quantity' })
        if (min === undefined || max === undefined) return
        // One of the two alone is a rule with the other at zero, or the minimum as its maximum.
        const minimum = min ?? (max === null ? null : 0)
        const maximum = max ?? minimum
        if (minimum !== null && maximum !== null && maximum < minimum)
          errors.push({ field: `rules.${index}.maxQuantity`, code: 'stock.error.orderpoint.range' })
        else rules.push({ productId, min: minimum, max: maximum })
      })
      if (errors.length) return { ok: false, errors }
      const existing = new Map(
        (await ours(ctx, 'stock.Orderpoint', { locationId })).map((row) => [String(row.productId), row]),
      )
      let saved = 0
      let cleared = 0
      await ctx.tx(async (tx) => {
        for (const rule of rules) {
          const current = existing.get(rule.productId)
          if (rule.min === null || rule.max === null) {
            if (current && current.active !== false) {
              await tx.db.update('stock.Orderpoint', { id: current.id }, { active: false })
              cleared += 1
            }
            continue
          }
          const values = {
            id: current ? String(current.id) : randomUUID(),
            productId: rule.productId,
            warehouseId: String(args.warehouseId),
            locationId,
            trigger: String(current?.trigger ?? 'auto'),
            minQuantity: String(rule.min),
            maxQuantity: String(rule.max),
            replenishmentUomId: String(current?.replenishmentUomId ?? template.uomId),
            active: true,
          }
          const changes = tx
            .change('stock.Orderpoint', values, current ?? null)
            .cast(Object.keys(values))
            .required(['productId', 'warehouseId', 'locationId', 'trigger', 'minQuantity', 'maxQuantity'])
          if (!changes.valid) throw new Error('orderpoint refused after validation')
          await tx.db.commit(changes, current ? { id: current.id } : undefined)
          saved += 1
        }
      })
      return { ok: true, saved, cleared }
    },
  }),
}
