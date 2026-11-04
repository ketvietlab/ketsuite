import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import type { MakeReplenishment, PlannedSupply } from '../stock/replenishment-policy.ts'
import { functions } from './functions.ts'

/**
 * P12: orders drafted from demand. A reorder rule whose source is manufacturing drafts an order
 * instead of a receipt, and confirming a sale drafts one for each line whose product's BOM makes to
 * order. Drafts carry where they came from; nothing is confirmed on anyone's behalf.
 */

const ours = async (ctx: Ctx, model: string, where: Row = {}) =>
  ctx.db.select(model, { ...where, companyId: ctx.scope.company })

const activeBom = async (ctx: Ctx, productId: unknown) =>
  (await ours(ctx, 'manufacturing.Bom', { productId })).find(
    (row) => String(row.state ?? (row.active === false ? 'archived' : 'active')) === 'active',
  )

/** `<warehouse code>/SX/0001`, the next number after the highest already taken. */
export async function nextProductionName(ctx: Ctx, code: string) {
  const prefix = `${code}/SX/`
  const taken = (await ours(ctx, 'manufacturing.Production'))
    .map((row) => String(row.name))
    .filter((name) => name.startsWith(prefix))
    .map((name) => Number.parseInt(name.slice(prefix.length), 10))
    .filter(Number.isFinite)
  return `${prefix}${String(Math.max(0, ...taken) + 1).padStart(4, '0')}`
}

const DRAFT_EFFECTS = [
  ...(functions.saveProduction!.effects ?? []),
  'read:manufacturing.Production',
  'write:manufacturing.Production',
  'read:manufacturing.Bom',
  'read:stock.Location',
  'read:stock.Warehouse',
  'read:product.Product',
  'read:product.Template',
]

/**
 * Drafts an order for `quantity` of the product's own unit into `locationId`, from its warehouse's
 * stock and the company's first production location. Null when the product has no BOM in use or
 * there is nowhere to make it. The same id answers the same order.
 */
export async function draftProduction(
  ctx: Ctx,
  input: {
    id: string
    productId: unknown
    quantity: number
    locationId: unknown
    origin: string
    at: string
    extra: Row
  },
): Promise<{ id: string; name: string } | null> {
  const existing = (await ours(ctx, 'manufacturing.Production', { id: input.id }))[0]
  if (existing) return { id: String(existing.id), name: String(existing.name) }
  const bom = await activeBom(ctx, input.productId)
  const product = (await ctx.db.select('product.Product', { id: input.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const destination = (await ours(ctx, 'stock.Location', { id: input.locationId }))[0]
  const making = (await ours(ctx, 'stock.Location', { usage: 'production' }))
    .filter((row) => row.active !== false)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0]
  if (!bom || !template?.uomId || !destination || !making || !(input.quantity > 0)) return null
  const warehouse = destination.warehouseId
    ? (await ours(ctx, 'stock.Warehouse', { id: destination.warehouseId }))[0]
    : undefined
  const stock = warehouse
    ? (await ours(ctx, 'stock.Location', { id: `${String(warehouse.id)}:stock` }))[0]
    : undefined
  const saved = (await functions.saveProduction!.handler(ctx, {
    id: input.id,
    name: await nextProductionName(ctx, String(warehouse?.code ?? 'SX')),
    bomId: bom.id,
    productQty: String(input.quantity),
    productUomId: template.uomId,
    sourceLocationId: stock?.id ?? destination.id,
    productionLocationId: making.id,
    destinationLocationId: destination.id,
    scheduledStart: input.at,
    origin: input.origin,
  })) as Row
  if (saved?.ok !== true) return null
  await ctx.db.update('manufacturing.Production', { id: input.id }, input.extra)
  const row = (await ours(ctx, 'manufacturing.Production', { id: input.id }))[0]!
  return { id: String(row.id), name: String(row.name) }
}

const href = (id: unknown) => `/admin/manufacturing/orders/${encodeURIComponent(String(id))}`

/** Manufacturing as a source of replenishment, for a Stock composition that makes goods. */
export const manufactureReplenishment: MakeReplenishment = {
  effects: [...new Set(DRAFT_EFFECTS)],
  async planned(ctx, filter) {
    const drafts = await ours(ctx, 'manufacturing.Production', {
      state: 'draft',
      ...(filter.productId ? { productId: filter.productId } : {}),
    })
    return drafts.map(
      (row): PlannedSupply => ({
        id: String(row.id),
        name: String(row.name),
        productId: String(row.productId),
        locationId: String(row.destinationLocationId),
        quantity: Number(row.productQty),
        date: row.deadline ? String(row.deadline) : row.scheduledStart ? String(row.scheduledStart) : null,
        href: href(row.id),
      }),
    )
  },
  async makes(ctx, productId) {
    return Boolean(await activeBom(ctx, productId))
  },
  async make(ctx, input) {
    const made = await draftProduction(ctx, {
      id: input.id,
      productId: input.productId,
      quantity: input.quantity,
      locationId: input.locationId,
      origin: input.origin,
      at: input.at,
      extra: {
        orderSource: 'rule',
        orderpointId: input.orderpointId,
        deadline: new Date(new Date(input.at).getTime() + input.leadDays * 86_400_000).toISOString(),
      },
    })
    return made ? { ...made, href: href(made.id) } : null
  },
}

const SALE_EFFECTS = [
  ...DRAFT_EFFECTS,
  ...(functions.cancelProduction!.effects ?? []),
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:uom.Unit',
]

const LIVE = ['sale', 'done']

/** A sale line's quantity in its product's own unit. */
async function baseQuantity(ctx: Ctx, line: Row) {
  const product = (await ctx.db.select('product.Product', { id: line.productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  const units = await ctx.db.select('uom.Unit')
  const unit = units.find((row) => row.id === (line.productUomId ?? template?.uomId))
  const base = units.find((row) => row.id === template?.uomId)
  return unit && base
    ? (Number(line.productUomQty) * Number(unit.absoluteFactor ?? 1)) / Number(base.absoluteFactor ?? 1)
    : Number(line.productUomQty)
}

/**
 * Drafts one order per line of a confirmed sale whose product's BOM makes to order, once: a line
 * that already has an order other than a cancelled one gets none. The deadline is the sale's
 * commitment date. With `lineIds`, only those lines are looked at.
 */
export async function ordersFromSale(ctx: Ctx, orderId: unknown, lineIds?: ReadonlySet<string>) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  if (!order || !LIVE.includes(String(order.state))) return []
  const warehouse = order.warehouseId
    ? (await ours(ctx, 'stock.Warehouse', { id: order.warehouseId }))[0]
    : undefined
  if (!warehouse) return []
  const made: Array<{ id: string; name: string }> = []
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId }))
    .filter((line) => line.productId && !line.displayType && Number(line.productUomQty) > 0)
    .filter((line) => !lineIds || lineIds.has(String(line.id)))
    .sort(
      (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || String(a.id).localeCompare(String(b.id)),
    )
  for (const line of lines) {
    const bom = await activeBom(ctx, line.productId)
    if (!bom?.toOrder) continue
    const previous = await ours(ctx, 'manufacturing.Production', { saleLineId: line.id })
    if (previous.some((row) => row.state !== 'cancelled')) continue
    // Reconfirmation is a new production attempt. Keep cancelled attempts immutable instead
    // of handing draftProduction an id which it correctly treats as an existing record.
    const baseId = `sale:${String(line.id)}`
    const used = new Set(previous.map((row) => String(row.id)))
    let id = baseId
    for (let attempt = 2; used.has(id); attempt += 1) id = `${baseId}:${attempt}`
    const draft = await draftProduction(ctx, {
      id,
      productId: line.productId,
      quantity: await baseQuantity(ctx, line),
      locationId: `${String(warehouse.id)}:stock`,
      origin: String(order.name),
      at: new Date().toISOString(),
      extra: {
        orderSource: 'sale',
        saleOrderId: order.id,
        saleLineId: line.id,
        deadline: order.commitmentDate ?? null,
      },
    })
    if (draft) made.push(draft)
  }
  return made
}

const cancelDraft = async (ctx: Ctx, row: Row, notice: string) => {
  const done = (await functions.cancelProduction!.handler(ctx, { id: row.id, version: row.version })) as Row
  if (done?.ok === true)
    await ctx.db.update('manufacturing.Production', { id: row.id }, { saleNotice: notice })
}

const warn = async (ctx: Ctx, row: Row, notice: string | null) => {
  if ((row.saleNotice ?? null) !== notice)
    await ctx.db.update('manufacturing.Production', { id: row.id }, { saleNotice: notice })
}

/**
 * Keeps the orders drafted from a sale in step with it (#1949). A cancelled sale, or one back to a
 * quotation, cancels its drafts; a line whose quantity changed resizes its draft, and a line removed
 * or brought to zero cancels it. An order someone already confirmed is never changed on the sale's
 * behalf: it carries `saleNotice` (`cancelled`, `changed`) until the quantities agree again.
 */
export async function reconcileSaleProductions(ctx: Ctx, orderId: unknown) {
  const order = (await ours(ctx, 'sale.Order', { id: orderId }))[0]
  const productions = (await ours(ctx, 'manufacturing.Production', { saleOrderId: orderId })).filter(
    (row) => row.state !== 'cancelled' && row.state !== 'done',
  )
  if (!order || !productions.length) return
  if (!LIVE.includes(String(order.state))) {
    for (const row of productions)
      if (row.state === 'draft') await cancelDraft(ctx, row, 'cancelled')
      else await warn(ctx, row, 'cancelled')
    return
  }
  const lines = new Map(
    (await ours(ctx, 'sale.OrderLine', { orderId })).map((line) => [String(line.id), line]),
  )
  for (const row of productions) {
    const line = lines.get(String(row.saleLineId))
    const wanted = line ? await baseQuantity(ctx, line) : 0
    if (row.state !== 'draft') {
      await warn(ctx, row, wanted === Number(row.productQty) ? null : 'changed')
      continue
    }
    if (!(wanted > 0)) {
      await cancelDraft(ctx, row, 'changed')
      continue
    }
    if (wanted === Number(row.productQty)) continue
    await functions.saveProduction!.handler(ctx, {
      id: row.id,
      version: row.version,
      name: row.name,
      bomId: row.bomId,
      productQty: String(wanted),
      productUomId: row.productUomId,
      sourceLocationId: row.sourceLocationId,
      productionLocationId: row.productionLocationId,
      destinationLocationId: row.destinationLocationId,
      scheduledStart: row.scheduledStart,
      scheduledFinish: row.scheduledFinish ?? null,
      origin: row.origin,
      priority: row.priority ?? null,
    })
  }
}

/** The sale orders a call's writes touched, and the lines it added. */
async function salesWrittenBy(ctx: Ctx, writes: Ctx['writes']) {
  const orders = new Map<string, { confirmed: boolean; added: Set<string> }>()
  const touch = (id: unknown) => {
    const key = String(id)
    if (!orders.has(key)) orders.set(key, { confirmed: false, added: new Set() })
    return orders.get(key)!
  }
  for (const write of writes) {
    if (write.op === 'enqueue') continue
    if (write.model === 'sale.Order') {
      const id = write.op === 'insert' ? write.row?.id : write.where?.id
      if (id == null) continue
      const entry = touch(id)
      if (LIVE.includes(String((write.op === 'insert' ? write.row : write.patch)?.state)))
        entry.confirmed = true
    } else if (write.model === 'sale.OrderLine') {
      if (write.op === 'insert' && write.row?.orderId != null) {
        touch(write.row.orderId).added.add(String(write.row.id))
        continue
      }
      if (write.where?.orderId != null) touch(write.where.orderId)
      const lineId = write.where?.id
      if (lineId == null) continue
      const line = (await ctx.db.select('sale.OrderLine', { id: lineId }))[0]
      if (line?.orderId != null) touch(line.orderId)
      // A deleted line is gone; its draft still names the order.
      for (const row of await ours(ctx, 'manufacturing.Production', { saleLineId: lineId }))
        if (row.saleOrderId != null) touch(row.saleOrderId)
    }
  }
  return orders
}

const writesSale = (spec: FnSpec) =>
  (spec.effects ?? []).some((effect) => effect === 'write:sale.Order' || effect === 'write:sale.OrderLine')

/**
 * Wraps a Sale module so that its orders' drafts follow them: whichever function confirms an order
 * (the order screen, an adapter, a channel) drafts its make-to-order orders, and whichever cancels
 * or changes one reconciles them (#1949). The orders a call touched are the ones its writes name,
 * plus its own `id`/`orderId`: a write inside a transaction of its own is still seen through those.
 * The drafts are written after the call returns, in the same request; a refused call drafts nothing.
 */
export function withSaleProductions<M extends { functions: Record<string, FnSpec> }>(module: M): M {
  const wrapped: Record<string, FnSpec> = { ...module.functions }
  let touched = false
  for (const [name, spec] of Object.entries(module.functions)) {
    if (!writesSale(spec)) continue
    touched = true
    wrapped[name] = {
      ...spec,
      effects: [...new Set([...(spec.effects ?? []), ...SALE_EFFECTS])],
      handler: async (ctx: Ctx, args: Row) => {
        const named = [args?.id, args?.orderId].filter((id) => id != null && id !== '').map(String)
        const before = new Map<string, string>()
        for (const id of named) {
          const row = (await ours(ctx, 'sale.Order', { id }))[0]
          if (row) before.set(id, String(row.state))
        }
        const start = ctx.writes.length
        const result = (await spec.handler(ctx, args)) as Row
        if (result && typeof result === 'object' && result.ok === false) return result
        const orders = await salesWrittenBy(ctx, ctx.writes.slice(start))
        for (const id of before.keys())
          if (!orders.has(id)) orders.set(id, { confirmed: false, added: new Set() })
        for (const [id, entry] of orders) {
          const order = (await ours(ctx, 'sale.Order', { id }))[0]
          if (!order) continue
          const live = LIVE.includes(String(order.state))
          const was = before.get(id)
          await reconcileSaleProductions(ctx, id)
          if (live && (entry.confirmed || (was !== undefined && !LIVE.includes(was))))
            await ordersFromSale(ctx, id)
          else if (live && entry.added.size) await ordersFromSale(ctx, id, entry.added)
        }
        return result
      },
    }
  }
  if (!touched) return module
  const optional = (module as { optional?: readonly string[] }).optional ?? []
  return {
    ...module,
    // The wrapped writes now draft and reconcile manufacturing orders.
    optional: [...new Set([...optional, 'manufacturing'])],
    functions: wrapped,
  }
}
