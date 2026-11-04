import { randomUUID } from 'node:crypto'
import type { Row } from '@ketvietlab/ketjs'
import stock from '../stock/index.ts'
import { createOrderpointFunctions } from '../stock/functions/orderpoints.ts'
import { createScrapFunctions } from '../stock/functions/scraps.ts'
import {
  ReplenishmentRefused,
  type MakeReplenishment,
  type SupplierReplenishment,
  type SupplyOption,
} from '../stock/replenishment-policy.ts'
import { createForecastFunctions } from '../stock/functions/availability.ts'
import { createPurchaseDraft, insertPurchaseLine } from './draft-write.ts'
import { lineEffects } from './line-plan.ts'
import { selectProductSupplier, SUPPLIER_SELECTION_EFFECTS } from './supplier-selection.ts'
import { supplierRows } from './product-supplier-policy.ts'
import { companyCalendar, supplierValidity } from './supplier-validity.ts'
import { inUnit, n } from './functions/shared.ts'

/** Requests for quotation not yet confirmed: what they ask for has no receipt yet. */
const OPEN_REQUESTS = ['draft', 'sent', 'to approve']

const suppliers: SupplierReplenishment = {
  effects: [...SUPPLIER_SELECTION_EFFECTS, 'read:purchase.Order', 'read:purchase.OrderLine'],
  requestEffects: [
    ...lineEffects,
    'read:purchase.Sequence',
    'write:purchase.Sequence',
    'read:partner.Partner',
    'read:stock.PickingType',
  ],
  async options(ctx, productId, at) {
    const product = (await ctx.db.select('product.Product', { id: productId }))[0]
    if (!product || product.active === false) return []
    const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    if (!template || template.active === false || template.purchaseOk !== true || template.type === 'combo')
      return []
    const options: SupplyOption[] = []
    const calendar = await companyCalendar(ctx)
    for (const row of await supplierRows(ctx, template.id)) {
      if (
        (row.productId && row.productId !== product.id) ||
        supplierValidity(row, at, calendar) !== 'current'
      )
        continue
      if (options.some((option) => option.partnerId === row.partnerId)) continue
      const partner = (await ctx.db.select('partner.Partner', { id: row.partnerId }))[0]
      if (
        !partner ||
        partner.active === false ||
        (await inUnit(ctx, 1, template.uomId, row.productUomId)) === null
      )
        continue
      options.push({
        partnerId: String(partner.id),
        name: String(partner.name),
        delay: Number(row.delay ?? 0),
      })
    }
    return options
  },
  async select(ctx, input) {
    const selected = await selectProductSupplier(ctx, input)
    if (!selected) return null
    const partner = (await ctx.db.select('partner.Partner', { id: selected.row.partnerId }))[0]
    return {
      partnerId: String(selected.row.partnerId),
      name: String(partner!.name),
      delay: Number(selected.row.delay ?? 0),
    }
  },
  // #1737: a supplier rule drafts a request for quotation, one per vendor and location; the buyer
  // prices, sends and confirms it, and confirming drafts the receipt.
  async request(ctx, input) {
    const held = (await ctx.db.select('purchase.Order', { replenishmentGroup: input.group, state: 'draft' }))
      .filter((order) => order.locked !== true)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0]
    let orderId = held ? String(held.id) : randomUUID()
    if (held) {
      // The draft must still be a draft when the line joins it, not sent meanwhile.
      const lock = await ctx.db.compareAndSet(
        'purchase.Order',
        { id: held.id },
        { state: 'draft' },
        { state: 'draft' },
      )
      if (!('dryRun' in lock) && !lock.matched) throw new ReplenishmentRefused('id', 'conflict')
    } else {
      const created = (await createPurchaseDraft(ctx, {
        id: orderId,
        partnerId: input.vendor.partnerId,
        pickingTypeId: input.pickingTypeId,
        datePlanned: input.scheduledDate,
      })) as Row
      if (created.ok !== true) throw new ReplenishmentRefused('vendorId', 'request')
      orderId = String(created.id)
      await ctx.db.update(
        'purchase.Order',
        { id: orderId },
        { replenishmentGroup: input.group, locationDestId: input.point.locationId },
      )
    }
    const line = (await insertPurchaseLine(ctx, {
      id: input.id,
      orderId,
      productId: input.point.productId,
      // The rule's quantity, already rounded to its unit; only float noise is dropped.
      productQty: String(Math.round(input.quantity * 1e6) / 1e6),
      productUomId: input.uomId,
      datePlanned: input.scheduledDate,
    })) as Row
    if (line.ok !== true || line.existing === true) throw new ReplenishmentRefused('moveId', 'conflict')
    await ctx.db.update('purchase.OrderLine', { id: input.id }, { orderpointId: input.point.id })
    return { orderId }
  },
  async requested(ctx, id) {
    const line = (await ctx.db.select('purchase.OrderLine', { id }))[0]
    if (!line) return null
    return {
      orderId: String(line.orderId),
      orderpointId: String(line.orderpointId ?? ''),
      productId: String(line.productId),
      quantity: String(line.productQty),
    }
  },
  async onOrder(ctx, point) {
    const product = (await ctx.db.select('product.Product', { id: point.productId }))[0]
    const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    if (!template?.uomId) return 0
    const orders = new Map<string, Row | null>()
    const types = new Map<string, Row | null>()
    let total = 0
    for (const line of await ctx.db.select('purchase.OrderLine', { productId: point.productId })) {
      const key = String(line.orderId)
      if (!orders.has(key))
        orders.set(key, (await ctx.db.select('purchase.Order', { id: line.orderId }))[0] ?? null)
      const order = orders.get(key)
      if (!order || !OPEN_REQUESTS.includes(String(order.state))) continue
      // Where its receipt will deliver: the rule's location, or the receipt type's default.
      let destination = order.locationDestId
      if (!destination) {
        const typeKey = String(order.pickingTypeId)
        if (!types.has(typeKey))
          types.set(
            typeKey,
            (await ctx.db.select('stock.PickingType', { id: order.pickingTypeId }))[0] ?? null,
          )
        destination = types.get(typeKey)?.defaultLocationDestId
      }
      if (destination !== point.locationId) continue
      const quantity = await inUnit(ctx, n(line.productQty), line.productUomId, template.uomId)
      if (quantity !== null) total += quantity
    }
    return total
  },
}

/**
 * Commerce opts in; other Stock compositions keep their route-only behavior and effects. With
 * `make`, a reorder rule may also draft manufacturing orders, and the forecast counts them (P12).
 */
export function stockWithProductSuppliers(options: { make?: MakeReplenishment } = {}) {
  const provider: SupplierReplenishment = options.make ? { ...suppliers, make: options.make } : suppliers
  return {
    ...stock,
    // Making stock reads and drafts manufacturing orders, so the rules name it.
    ...(options.make ? { optional: [...new Set([...(stock.optional ?? []), 'manufacturing'])] } : {}),
    functions: {
      ...stock.functions,
      ...createOrderpointFunctions(provider),
      // K59: a scrap order's replenishment runs the same supplier-aware rule.
      ...createScrapFunctions(provider),
      ...(options.make ? createForecastFunctions(options.make) : {}),
    },
  }
}
