import { isStructuralLine, validFreeLine, validSaleLine } from '../free-lines.ts'
import { deliveryPatch, deliverySchedule } from '../delivery-promise.ts'
import { COMBO_LINE_EFFECTS, planComboItems } from '../combo-lines.ts'
import { captureLineCost, deleteLineCosts, LINE_COST_EFFECTS } from '../line-cost.ts'
import { saleUnitRatio } from '../unit-ratio.ts'
import { VARIANT_PRICE_EFFECTS } from '../../product/variant-price.ts'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { quoteSaleLine as quoteTaxLine } from '../tax-quote.ts'
import { compareDecimals, multiplyDecimals } from '../../account/money.ts'
import { functions as pricingFunctions } from '../../pricing/functions.ts'
import { sellableProduct } from '../../product/sellable.ts'
import { describeVariantName, VARIANT_NAME_EFFECTS } from '../../product/functions/variants.ts'
import { ours } from '../scope.ts'
import {
  invalid,
  externalOrder,
  authorityRefusal,
  n,
  recompute,
  SaleRefused,
  claimRevision,
} from './shared.ts'
import { createOrder } from '../create-order.ts'
import { ORDER_SALES_EFFECTS } from '../teams.ts'
import { salesConfiguration, soldInvoicePolicy } from '../configuration.ts'

// The grid reads these in the viewer's language; API clients keep the developer message.
const lineRefusal = (field: string, message: string, key: string) => ({
  ok: false,
  errors: [{ field, message, messageKey: `sale.error.${key}` }],
})
const SELLABLE_KEYS: Record<string, string> = {
  'product variant is missing or inactive': 'productUnavailable',
  'product is not available for sale': 'productUnavailable',
  'product has no default unit of measure': 'productNoUnit',
  'product default unit does not exist': 'productNoUnit',
  'unit of measure is not enabled for this product': 'unitNotEnabled',
}

/** Shared quotation-line write, using the caller’s transaction and authorization. */
export async function writeQuotationLine(
  ctx: Ctx,
  args: Row,
  retainedCost?: Row,
  selections: Row[] = [],
  child?: Row,
  confirmed = false,
) {
  const order = (await ours(ctx, 'sale.Order', { id: args.orderId }))[0]
  if (externalOrder(order)) return authorityRefusal()
  if (
    !order ||
    !(confirmed ? ['draft', 'sent', 'sale'] : ['draft', 'sent']).includes(String(order.state)) ||
    order.locked
  )
    // Form-level: no grid cell is named for the order.
    return lineRefusal('orderId', 'lines can only be added to an unlocked quotation', 'quotationLocked')
  if (args.displayType) {
    if (!isStructuralLine(args) || !validSaleLine(args) || child)
      return invalid('name', 'sale.error.gridRequired')
    const held = (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]
    if (held && held.orderId !== args.orderId) return invalid('id', 'line identifier is already in use')
    if (!held)
      await ctx.db.insert('sale.OrderLine', {
        id: args.id,
        orderId: args.orderId,
        name: String(args.name).trim(),
        displayType: args.displayType,
        optionalSection: args.displayType === 'section' && args.optionalSection === true,
        productId: null,
        productUomId: null,
        productUomQty: '0',
        priceUnit: '0',
        discount: '0',
        taxId: null,
        taxIds: [],
        qtyDelivered: '0',
        qtyInvoiced: '0',
        priceSubtotal: '0',
        priceSubtotalIncl: '0',
        sequence: args.sequence ?? 10,
      })
    await recompute(ctx, args.orderId)
    return { ok: true, id: args.id, priceUnit: '0' }
  }
  if (compareDecimals(args.productUomQty, '0') < 0)
    return lineRefusal('productUomQty', 'ordered quantity must not be negative', 'quantityPositive')
  const sellable = args.productId
    ? await sellableProduct(ctx, args.productId, args.productUomId, { allowCombo: !child })
    : null
  if (sellable && !sellable.ok)
    return lineRefusal(
      sellable.field === 'uomId' ? 'productUomId' : sellable.field,
      sellable.message,
      SELLABLE_KEYS[sellable.message] ?? 'productUnavailable',
    )
  const productContext = sellable?.ok ? sellable.value : null
  if (!productContext && (!validFreeLine(args) || child))
    return invalid('name', 'sale.error.freeLineRequired')
  const isCombo = productContext?.template.type === 'combo'
  const held = (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]
  if (held && isCombo) {
    if (held.orderId !== args.orderId || held.productId !== args.productId || held.comboBasePrice == null)
      return invalid('id', 'line identifier is already in use')
    return { ok: true, id: held.id, priceUnit: '0' }
  }
  // A product line without a unit sells in the product's own unit, as the line form leaves it.
  const productUomId = productContext
    ? args.productUomId || productContext.template.uomId
    : args.productUomId || null
  const ratio = productContext ? await saleUnitRatio(ctx, productUomId, productContext.template.uomId) : 1
  if (ratio === null)
    return lineRefusal('productUomId', 'unit of measure cannot be converted', 'unitNotConvertible')
  const priceAutomatic =
    !!productContext && !isCombo && !child && (args.priceAutomatic === true || args.priceUnit == null)
  let discount = args.discount ?? '0'
  let priceUnit: unknown = priceAutomatic ? undefined : args.priceUnit
  if (priceUnit === undefined && order.pricelistId && productContext) {
    const priced = (await pricingFunctions.priceForLine!.handler(ctx, {
      pricelistId: order.pricelistId,
      productId: args.productId,
      quantity: args.productUomQty,
      uomId: productUomId,
      date: order.dateOrder,
    })) as Row
    if (priced.ok !== true) return priced
    priceUnit = priced.priceUnit ?? priced.price
    if (priceAutomatic) discount = priced.discount ?? '0'
  }
  priceUnit ??= multiplyDecimals(
    productContext?.listPrice ?? '0',
    ratio.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 }),
  )
  if (compareDecimals(priceUnit, '0') < 0)
    return lineRefusal('priceUnit', 'unit price and discount are invalid', 'pricePositive')
  if (compareDecimals(discount, '0') < 0 || compareDecimals(discount, '100') > 0)
    return lineRefusal('discount', 'unit price and discount are invalid', 'discountRange')
  if (isCombo && !(await claimRevision(ctx, order)))
    throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
  const children = isCombo
    ? await planComboItems(
        ctx,
        productContext!.template,
        { ...args, productUomId, discount },
        String(priceUnit),
        order.currency,
        selections,
      )
    : []
  if (
    isCombo &&
    (await ours(ctx, 'sale.OrderLine', { orderId: args.orderId })).length + children.length + 1 > 100
  )
    throw new SaleRefused(invalid('lines', 'sale.error.gridTooMany'))
  const comboBasePrice = isCombo ? String(priceUnit) : null
  if (isCombo) priceUnit = '0'
  // Keep the established Sales contract: omitting tax means tax-free. POS resolves the product
  // default explicitly through its own quote boundary before creating a line.
  const taxIds = args.taxIds !== undefined ? args.taxIds : args.taxId ? [args.taxId] : []
  const quote = await quoteTaxLine(ctx, {
    productId: args.productId,
    taxIds,
    quantity: args.productUomQty,
    priceUnit,
    discount,
  })
  if (quote.ok !== true) {
    if (isCombo) throw new SaleRefused(quote)
    return quote
  }
  if (!(await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]) {
    await ctx.db.insert('sale.OrderLine', {
      id: args.id,
      orderId: args.orderId,
      productId: args.productId || null,
      // The line keeps the variant's full name, as the picker showed it (P29).
      name: productContext
        ? (typeof args.name === 'string' && args.name.trim()) ||
          (await describeVariantName(ctx, productContext.product, productContext.template))
        : String(args.name).trim(),
      productUomQty: args.productUomQty,
      productUomId,
      priceUnit: String(priceUnit),
      priceAutomatic,
      discount: String(discount),
      taxId: quote.taxIds[0] ?? null,
      taxIds: quote.taxIds,
      taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
      quoteRevision: args.quoteRevision ?? null,
      comboBasePrice,
      comboParentId: child?.comboParentId ?? null,
      comboChoiceId: child?.comboChoiceId ?? null,
      qtyDelivered: '0',
      qtyInvoiced: '0',
      // A line added to a sold order is invoiced by the policy in force now (D20).
      ...(order.state === 'sale'
        ? { invoicePolicy: soldInvoicePolicy(productContext?.template, await salesConfiguration(ctx)) }
        : {}),
      priceSubtotal: quote.amountUntaxed,
      priceSubtotalIncl: quote.amountTotal,
      sequence: args.sequence ?? 10,
    })
    // The cost is per the unit the line sells in, the product's own when a new line left it empty.
    if (!isCombo && productContext)
      await captureLineCost(
        ctx,
        { ...args, productUomId },
        productContext.template.uomId,
        ratio,
        retainedCost,
      )
    for (const item of children) {
      const added = await writeQuotationLine(ctx, item, undefined, [], item)
      if (!added.ok) throw new SaleRefused(added)
    }
  }
  await recompute(ctx, args.orderId)
  return { ok: true, id: args.id, priceUnit: String(priceUnit) }
}

export async function addLineHandler(ctx: Ctx, args: Row) {
  return writeQuotationLine(ctx, args)
}

/** Replace only quotation lines inside a caller-owned transaction. Header policies stay with saveDraft. */
export async function replaceQuotationLines(tx: Ctx, orderId: unknown, lines: Row[]) {
  if (lines.length > 100 || lines.some((line) => !line.id || !validSaleLine(line)))
    throw new SaleRefused(invalid('lines', 'sale.error.freeLineRequired'))
  const held = await ours(tx, 'sale.OrderLine', { orderId })
  const known = new Map(held.map((line) => [String(line.id), line]))
  for (const line of held) {
    if (
      (await tx.db.select('stock.Move', { saleLineId: line.id })).length ||
      (await tx.db.select('account.MoveLine', { saleLineId: line.id })).length
    )
      throw new SaleRefused(invalid('lines', 'sale.error.gridHistory'))
  }
  for (const line of lines) {
    const previous = known.get(String(line.id))
    if (previous?.lineKind === 'discount' || previous?.lineKind === 'reward') {
      for (const field of [
        'productId',
        'productUomId',
        'productUomQty',
        'priceUnit',
        'discount',
        'name',
        'displayType',
        'taxIds',
        'taxId',
      ])
        if (line[field] !== undefined && JSON.stringify(line[field]) !== JSON.stringify(previous[field]))
          throw new SaleRefused(invalid(field, 'sale.error.discountLocked'))
    }
    if (!previous?.comboParentId) continue
    for (const field of ['productUomQty', 'productUomId', 'priceUnit', 'discount', 'taxIds', 'taxId']) {
      if (line[field] !== undefined && JSON.stringify(line[field]) !== JSON.stringify(previous[field]))
        throw new SaleRefused(invalid(field, 'sale.error.comboChildLocked'))
    }
  }
  const parents = lines.filter((line) => !known.get(String(line.id))?.comboParentId)
  const retainedCosts = await ours(tx, 'sale.OrderLineCost', { orderId })
  await deleteLineCosts(tx, 'orderId', orderId)
  const L = tx.table('sale.OrderLine')
  await tx.db.del(deleteFrom(L).where(eq(L.orderId, String(orderId))))
  for (const [index, line] of parents.entries()) {
    const previous = known.get(String(line.id))
    if (previous?.lineKind === 'discount' || previous?.lineKind === 'reward') {
      const { companyId: _companyId, ...preserved } = previous
      await tx.db.insert('sale.OrderLine', { ...preserved, sequence: (index + 1) * 100 })
      await recompute(tx, orderId)
      continue
    }
    const selections = held
      .filter((item) => item.comboParentId === line.id)
      .map((item) => ({
        ...item,
        productId: lines.find((row) => row.id === item.id)?.productId ?? item.productId,
      }))
    const added = (await writeQuotationLine(
      tx,
      {
        id: line.id,
        orderId,
        productId: line.productId,
        productUomQty: line.productUomQty,
        productUomId: line.productUomId,
        sequence: (index + 1) * 100,
        name: line.name,
        displayType: line.displayType,
        optionalSection: line.optionalSection,
        priceAutomatic:
          line.priceAutomatic ??
          (previous &&
          line.productId === previous.productId &&
          line.productUomId === previous.productUomId &&
          line.priceUnit != null &&
          compareDecimals(line.priceUnit, previous.priceUnit) === 0
            ? previous.priceAutomatic
            : undefined),
        priceUnit:
          previous?.comboBasePrice != null &&
          (line.priceUnit == null || compareDecimals(String(line.priceUnit), '0') === 0)
            ? previous.comboBasePrice
            : line.priceUnit,
        discount: line.discount,
        taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
      },
      retainedCosts.find((cost) => cost.lineId === line.id),
      selections,
    )) as Row
    if (added.ok !== true) throw new SaleRefused(added)
  }
  if ((await ours(tx, 'sale.OrderLine', { orderId })).length > 100)
    throw new SaleRefused(invalid('lines', 'sale.error.gridTooMany'))
  if (!parents.length) await recompute(tx, orderId)
}

export async function saveDraftInTransaction(tx: Ctx, args: Row) {
  const lines = Array.isArray(args.lines) ? (args.lines as Row[]) : []
  if (!args.create && args.expectedRevision === undefined)
    throw new SaleRefused(invalid('expectedRevision', 'sales order version is required'))
  if (!lines.length || lines.length > 100)
    throw new SaleRefused(invalid('lines', 'a draft needs 1 to 100 lines'))
  if (lines.some((line) => !line || typeof line !== 'object' || !line.id || !validSaleLine(line)))
    throw new SaleRefused(invalid('lines', 'sale.error.freeLineRequired'))

  let order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
  if (externalOrder(order)) throw new SaleRefused(authorityRefusal())
  if (args.create && order) return
  if (!order) {
    if (!args.create) throw new SaleRefused(invalid('id', 'sales order does not exist'))
    const created = (await createOrder(tx, {
      id: args.id,
      partnerId: args.partnerId,
      warehouseId: args.warehouseId,
      clientOrderRef: args.clientOrderRef,
      notes: args.notes,
      shippingPolicy: args.shippingPolicy,
      commitmentDate: args.commitmentDate,
    })) as Row
    if (created.ok !== true) throw new SaleRefused(created)
    order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
  } else {
    if (order.state !== 'draft' || order.locked)
      throw new SaleRefused(invalid('state', 'only an unlocked quotation can be updated'))
    if (!(await claimRevision(tx, order, args.expectedRevision)))
      throw new SaleRefused(invalid('expectedRevision', 'sales order changed'))
  }
  if (!order) throw new SaleRefused(invalid('id', 'sales order does not exist'))
  const deliveryError = await deliveryPatch(tx, args, order)
  if (deliveryError) throw new SaleRefused(deliveryError)
  if (!(await tx.db.select('partner.Partner', { id: args.partnerId }))[0])
    throw new SaleRefused(invalid('partnerId', 'customer does not exist'))
  if (!(await tx.db.select('partner.Role', { partnerId: args.partnerId, role: 'customer' }))[0])
    throw new SaleRefused(invalid('partnerId', 'partner is not an active customer'))
  if (!(await ours(tx, 'stock.Warehouse', { id: args.warehouseId }))[0])
    throw new SaleRefused(invalid('warehouseId', 'warehouse does not exist'))

  await tx.db.update(
    'sale.Order',
    { id: args.id },
    {
      partnerId: args.partnerId,
      warehouseId: args.warehouseId,
      clientOrderRef: args.clientOrderRef ?? null,
      notes: args.notes ?? null,
      ...(Object.hasOwn(args, 'shippingPolicy') ? { shippingPolicy: args.shippingPolicy ?? 'direct' } : {}),
      ...(Object.hasOwn(args, 'commitmentDate')
        ? { commitmentDate: args.commitmentDate ? await deliverySchedule(tx, args.commitmentDate) : null }
        : {}),
    },
  )
  // Keep saveDraft's established input contract: only product/unit/quantity are writable here.
  // The line grid supplies its separately validated commercial patch through the shared writer.
  await replaceQuotationLines(
    tx,
    args.id,
    lines.map((line) => ({
      id: line.id,
      displayType: line.displayType,
      productId: line.productId,
      productUomId: line.productUomId,
      productUomQty: line.productUomQty,
      ...(!line.productId
        ? {
            name: line.name,
            priceUnit: line.priceUnit,
            discount: line.discount,
            taxIds: line.taxIds ?? (line.taxId ? [line.taxId] : []),
          }
        : {}),
    })),
  )
}

export async function saveDraftHandler(ctx: Ctx, args: Row) {
  try {
    await ctx.tx((tx) => saveDraftInTransaction(tx, args))
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  return { ok: true, id: args.id, revision: n(order?.revision) }
}

export async function removeQuotationLine(ctx: Ctx, args: Row) {
  const line = (await ours(ctx, 'sale.OrderLine', { id: args.id }))[0]
  if (!line) return { ok: true, id: args.id }
  const order = (await ours(ctx, 'sale.Order', { id: line.orderId }))[0]
  if (externalOrder(order)) return authorityRefusal()
  if (!order || !['draft', 'sent'].includes(String(order.state)) || order.locked)
    return invalid('id', 'lines can only be removed from an unlocked quotation')
  if (line.comboParentId) return { ok: true, id: line.id, orderId: line.orderId }
  const children = await ours(ctx, 'sale.OrderLine', { comboParentId: line.id })
  for (const item of [line, ...children]) {
    if (
      (await ctx.db.select('stock.Move', { saleLineId: item.id })).length ||
      (await ctx.db.select('account.MoveLine', { saleLineId: item.id })).length
    )
      return invalid('id', 'sale.error.comboHistory')
  }
  if (!(await claimRevision(ctx, order))) return invalid('expectedRevision', 'sales order changed')
  for (const item of children) {
    await deleteLineCosts(ctx, 'lineId', item.id)
    const Child = ctx.table('sale.OrderLine')
    await ctx.db.del(deleteFrom(Child).where(eq(Child.id, String(item.id))))
  }
  await deleteLineCosts(ctx, 'lineId', args.id)
  const L = ctx.table('sale.OrderLine')
  await ctx.db.del(deleteFrom(L).where(eq(L.id, String(args.id))))
  await recompute(ctx, line.orderId)
  return { ok: true, id: args.id, orderId: line.orderId }
}

export async function removeLineHandler(ctx: Ctx, args: Row) {
  return ctx.tx((tx) => removeQuotationLine(tx, args))
}

/** HTTP commands own a transaction; exported function specs compose in the caller's transaction. */
export async function addLineCommandHandler(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx((tx) => writeQuotationLine(tx, args))
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}

export const linesFunctions: Record<string, FnSpec> = {
  addLine: defineFn({
    input: {
      id: 'id',
      orderId: 'id',
      productId: 'id?',
      name: 'text?',
      displayType: 'text?',
      productUomQty: 'decimal',
      productUomId: 'id?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      taxIds: 'json?',
      quoteRevision: 'text?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', priceUnit: 'decimal?', errors: 'json?' },
    effects: [
      ...LINE_COST_EFFECTS,
      ...COMBO_LINE_EFFECTS,
      'read:stock.Move',
      'read:account.MoveLine',
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      ...VARIANT_PRICE_EFFECTS,
      ...VARIANT_NAME_EFFECTS,
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
      // A line added to a sold order takes the company's invoicing policy (D20).
      'read:sale.Configuration',
    ],
    idempotent: true,
    agent: true,
    handler: addLineHandler,
  }),
  saveDraft: defineFn({
    input: {
      shippingPolicy: 'text?',
      commitmentDate: 'datetime?',
      id: 'id',
      partnerId: 'id',
      warehouseId: 'id',
      clientOrderRef: 'text?',
      notes: 'text?',
      lines: 'json',
      create: 'bool?',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...LINE_COST_EFFECTS,
      ...COMBO_LINE_EFFECTS,
      'read:stock.Move',
      'read:account.MoveLine',
      'read:sale.Sequence',
      'write:sale.Sequence',
      'read:sale.Order',
      'write:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'read:partner.Partner',
      'read:partner.Role',
      'read:stock.Warehouse',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:pricing.Pricelist',
      'read:sale.CustomerTerms',
      ...ORDER_SALES_EFFECTS,
      'read:sale.Configuration',
      'read:pricing.PricelistItem',
      ...VARIANT_PRICE_EFFECTS,
      ...VARIANT_NAME_EFFECTS,
      'read:account.PaymentTerm',
      'read:account.Tax',
      'read:account.ProductTax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: saveDraftHandler,
  }),
  removeLine: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', orderId: 'id?', errors: 'json?' },
    effects: [
      ...LINE_COST_EFFECTS,
      ...COMBO_LINE_EFFECTS,
      'read:stock.Move',
      'read:account.MoveLine',
      'read:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'write:sale.Order',
      'read:account.Tax',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    // A line could be added and never taken back. A quotation with the wrong
    // product on it had to be abandoned and raised again under a new number,
    // because nothing in `sale` — function or route — could remove a line.
    handler: removeLineHandler,
  }),
}
