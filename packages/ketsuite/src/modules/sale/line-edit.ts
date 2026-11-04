import { invoicedQuantity } from './invoice-settlement.ts'
import { automaticLinePrice } from './automatic-price.ts'
import { resizeComboDemand } from './combo-demand.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import { planComboItems } from './combo-lines.ts'
import { describeVariantName } from '../product/functions/variants.ts'
import { claimRevision, recompute, refreshStatus, SaleRefused } from './functions/shared.ts'
import { captureLineCost } from './line-cost.ts'
import { saleUnitRatio } from './unit-ratio.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { quoteSaleLine as quoteTaxLine } from './tax-quote.ts'
import { compareDecimals, minorText, scaleOf, sumMoneyMinor } from '../account/money.ts'
import { ours } from './scope.ts'

const refused = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, message: `sale.error.${code}` }],
})
class LineEditRefused extends Error {
  readonly result: ReturnType<typeof refused>
  constructor(result: ReturnType<typeof refused>) {
    super('sale line edit refused')
    this.result = result
  }
}

/** The parent owns commercial fields; a child only chooses an offered SKU. */
async function updateComboLine(tx: Ctx, order: Row, line: Row, args: Row) {
  if (Number(args.expectedRevision) !== Number(order.revision))
    return refused('expectedRevision', 'orderChanged')
  const parent = line.comboParentId ? (await ours(tx, 'sale.OrderLine', { id: line.comboParentId }))[0] : line
  if (!parent || parent.orderId !== order.id || parent.comboBasePrice == null)
    return refused('id', 'lineMissing')
  const children = (await ours(tx, 'sale.OrderLine', { comboParentId: parent.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence),
  )
  if (line.comboParentId) {
    for (const field of ['priceUnit', 'discount', 'taxIds', 'productUomQty'])
      if (args[field] !== undefined && JSON.stringify(args[field]) !== JSON.stringify(line[field]))
        return refused(field, 'comboChildLocked')
  } else if (args.productId !== undefined && args.productId !== parent.productId)
    return refused('productId', 'comboChildLocked')
  const quantity = line.comboParentId ? parent.productUomQty : (args.productUomQty ?? parent.productUomQty)
  const price = line.comboParentId ? parent.comboBasePrice : (args.priceUnit ?? parent.comboBasePrice)
  const discount = line.comboParentId ? parent.discount : (args.discount ?? parent.discount)
  if (compareDecimals(quantity, '0') < 0) return refused('productUomQty', 'quantityPositive')
  if (compareDecimals(price, '0') < 0) return refused('priceUnit', 'pricePositive')
  if (compareDecimals(discount, '0') < 0 || compareDecimals(discount, '100') > 0)
    return refused('discount', 'discountRange')
  // Stock/invoice relations protect history even before cached delivered/invoiced quantities sync.
  let history = false
  for (const child of children) {
    const moves = await tx.db.select('stock.Move', { saleLineId: child.id })
    const invoices = await tx.db.select('account.MoveLine', { saleLineId: child.id })
    if (
      moves.length ||
      invoices.length ||
      compareDecimals(child.qtyDelivered, '0') > 0 ||
      compareDecimals(child.qtyInvoiced, '0') > 0
    )
      history = true
  }
  if (history) {
    if (
      line.comboParentId ||
      compareDecimals(discount, parent.discount) !== 0 ||
      (args.taxIds !== undefined && JSON.stringify(args.taxIds) !== JSON.stringify(parent.taxIds))
    )
      return refused('id', 'comboHistory')
    if (!(await claimRevision(tx, order, args.expectedRevision)))
      return refused('expectedRevision', 'orderChanged')
    // Historical unit prices stay frozen; only remaining demand and quantities may change.
    if (compareDecimals(quantity, parent.productUomQty) !== 0) {
      await resizeComboDemand(tx, order, children, quantity)
      for (const child of children) {
        const quote = await quoteTaxLine(tx, {
          productId: child.productId,
          quantity,
          priceUnit: child.priceUnit,
          discount: child.discount,
          taxIds: child.taxIds,
        })
        if (!quote.ok) throw new SaleRefused(quote)
        await tx.db.update(
          'sale.OrderLine',
          { id: child.id },
          {
            productUomQty: quantity,
            priceSubtotal: quote.amountUntaxed,
            priceSubtotalIncl: quote.amountTotal,
          },
        )
      }
    }
    await tx.db.update(
      'sale.OrderLine',
      { id: parent.id },
      { comboBasePrice: price, productUomQty: quantity },
    )
    await recompute(tx, order.id)
    await refreshStatus(tx, order.id)
    return {
      ok: true,
      id: parent.id,
      revision: (await ours(tx, 'sale.Order', { id: order.id }))[0]?.revision,
    }
  }
  const product = (await tx.db.select('product.Product', { id: parent.productId }))[0]
  const template = product && (await tx.db.select('product.Template', { id: product.templateId }))[0]
  if (!template) return refused('id', 'lineMissing')
  const selections = children.map((child) => ({
    ...child,
    productId: child.id === line.id ? (args.productId ?? child.productId) : child.productId,
  }))
  if (!(await claimRevision(tx, order, args.expectedRevision)))
    return refused('expectedRevision', 'orderChanged')
  const planned = await planComboItems(
    tx,
    template,
    {
      ...parent,
      productUomQty: quantity,
      discount,
      taxIds: line.comboParentId ? parent.taxIds : (args.taxIds ?? parent.taxIds),
    },
    String(price),
    order.currency,
    selections,
  )
  if (
    planned.length !== children.length ||
    planned.some((item) => !children.some((child) => child.id === item.id))
  )
    throw new SaleRefused(refused('id', 'comboUnavailable'))
  for (const item of planned) {
    const quote = await quoteTaxLine(tx, {
      productId: item.productId,
      taxIds: item.taxIds,
      quantity: item.productUomQty,
      priceUnit: item.priceUnit,
      discount: item.discount,
    })
    if (!quote.ok) throw new SaleRefused(quote)
    const sku = (await tx.db.select('product.Product', { id: item.productId }))[0]!
    const itemTemplate = (await tx.db.select('product.Template', { id: sku.templateId }))[0]!
    await tx.db.update(
      'sale.OrderLine',
      { id: item.id },
      {
        ...item,
        name: await describeVariantName(tx, sku, itemTemplate),
        taxId: quote.taxIds[0] ?? null,
        taxIds: quote.taxIds,
        taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
        priceSubtotal: quote.amountUntaxed,
        priceSubtotalIncl: quote.amountTotal,
        quoteRevision: null,
      },
    )
    const previous = children.find((child) => child.id === item.id)!
    if (previous.productId !== item.productId) await captureLineCost(tx, item, itemTemplate.uomId, 1)
  }
  await tx.db.update(
    'sale.OrderLine',
    { id: parent.id },
    {
      comboBasePrice: price,
      productUomQty: quantity,
      discount,
      taxIds: line.comboParentId ? parent.taxIds : (args.taxIds ?? parent.taxIds),
    },
  )
  await recompute(tx, order.id)
  return { ok: true, id: line.id, revision: (await ours(tx, 'sale.Order', { id: order.id }))[0]?.revision }
}

/** Edit a single line; automatic prices requote only before stock or invoice history exists.
 * Catalogue callers own the transaction and may resize unlocked confirmed demand. */
export async function editSaleLine(
  ctx: Ctx,
  args: Row,
  catalogue = false,
  inTransaction: boolean | 'confirmed-grid' = false,
) {
  const confirmedGrid = inTransaction === 'confirmed-grid'
  try {
    const edit = async (tx: Ctx) => {
      const line = (await ours(tx, 'sale.OrderLine', { id: args.id }))[0]
      if (!line) return refused('id', 'lineMissing')
      if (line.displayType || line.lineKind === 'discount' || line.lineKind === 'reward')
        return refused('id', 'lineNotEditable')
      const order = (await ours(tx, 'sale.Order', { id: line.orderId }))[0]
      if (
        !order ||
        !(
          catalogue || confirmedGrid || line.comboParentId || line.comboBasePrice != null
            ? ['draft', 'sent', 'sale']
            : ['draft', 'sent']
        ).includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return refused('id', 'lineNotEditable')
      if (line.comboParentId || line.comboBasePrice != null) return updateComboLine(tx, order, line, args)
      if (Number(args.expectedRevision) !== Number(order.revision))
        return refused('expectedRevision', 'orderChanged')
      if (typeof args.productUomQty !== 'string' || compareDecimals(args.productUomQty, '0') < 0)
        return refused('productUomQty', 'quantityPositive')
      const moves = await tx.db.select('stock.Move', { saleLineId: line.id })
      const invoices = await tx.db.select('account.MoveLine', { saleLineId: line.id })
      const history =
        moves.length > 0 ||
        invoices.length > 0 ||
        compareDecimals(line.qtyDelivered ?? '0', '0') > 0 ||
        compareDecimals(line.qtyInvoiced ?? '0', '0') > 0
      if (
        confirmedGrid &&
        compareDecimals(args.productUomQty, line.productUomQty) < 0 &&
        (compareDecimals(args.productUomQty, await invoicedQuantity(tx, line)) < 0 ||
          compareDecimals(args.productUomQty, line.qtyDelivered ?? '0') < 0)
      )
        return refused('productUomQty', 'belowSettled')
      const priceAutomatic = args.priceAutomatic ?? (args.priceUnit == null && line.priceAutomatic === true)
      let discount = args.discount ?? line.discount
      let priceUnit = args.priceUnit ?? line.priceUnit
      if (priceAutomatic && !history) {
        const priced = await automaticLinePrice(tx, order, line, args.productUomQty)
        if (!priced.ok) return priced
        priceUnit = priced.priceUnit
        if (args.discount == null) discount = priced.discount ?? '0'
      }
      if (catalogue && history) priceUnit = line.priceUnit
      if (compareDecimals(priceUnit, '0') < 0) return refused('priceUnit', 'pricePositive')
      if (compareDecimals(discount, '0') < 0 || compareDecimals(discount, '100') > 0)
        return refused('discount', 'discountRange')
      const quote = await quoteTaxLine(tx, {
        productId: line.productId,
        taxIds: args.taxIds ?? line.taxIds ?? (line.taxId ? [line.taxId] : []),
        quantity: args.productUomQty,
        priceUnit,
        discount,
      })
      if (!quote.ok) return quote
      const product = (await tx.db.select('product.Product', { id: line.productId }))[0]
      const template = product && (await tx.db.select('product.Template', { id: product.templateId }))[0]
      const ratio = line.productId
        ? template && (await saleUnitRatio(tx, line.productUomId, template.uomId))
        : 1
      if (ratio == null) return refused('id', 'quoteFailed')
      const changed = await tx.db.compareAndSet(
        'sale.Order',
        { id: order.id },
        { revision: order.revision, state: order.state, locked: order.locked },
        { revision: Number(order.revision) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched) return refused('expectedRevision', 'orderChanged')
      if (
        (catalogue || confirmedGrid) &&
        order.state === 'sale' &&
        line.productId &&
        compareDecimals(args.productUomQty, line.productUomQty) !== 0
      )
        await resizeComboDemand(tx, order, [line], args.productUomQty)
      await tx.db.update(
        'sale.OrderLine',
        { id: line.id },
        {
          priceAutomatic,
          productUomQty: args.productUomQty,
          priceUnit,
          discount,
          taxId: quote.taxIds[0] ?? null,
          taxIds: quote.taxIds,
          taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
          quoteRevision: null,
          priceSubtotal: quote.amountUntaxed,
          priceSubtotalIncl: quote.amountTotal,
        },
      )
      if (!history && line.lineKind !== 'reward' && template)
        await captureLineCost(tx, line, template.uomId, ratio)
      const lines = await ours(tx, 'sale.OrderLine', { orderId: order.id })
      const amounts = await Promise.all(
        lines.map(async (row) => {
          if (row.priceSubtotalIncl != null)
            return { untaxed: row.priceSubtotal, total: row.priceSubtotalIncl }
          const historical = await quoteTaxLine(tx, {
            productId: row.productId,
            taxIds: row.taxIds ?? (row.taxId ? [row.taxId] : []),
            quantity: row.productUomQty,
            priceUnit: row.priceUnit,
            discount: row.discount,
          })
          if (!historical.ok) throw new LineEditRefused(refused('id', 'quoteFailed'))
          return { untaxed: historical.amountUntaxed, total: historical.amountTotal }
        }),
      )
      const scale = scaleOf(order.currency)
      const untaxed = sumMoneyMinor(
        amounts.map((row) => row.untaxed),
        scale,
      )
      const total = sumMoneyMinor(
        amounts.map((row) => row.total),
        scale,
      )
      await tx.db.update(
        'sale.Order',
        { id: order.id },
        {
          amountUntaxed: minorText(untaxed, scale),
          amountTotal: minorText(total, scale),
          amountTax: minorText(total - untaxed, scale),
        },
      )
      if ((catalogue || confirmedGrid) && order.state === 'sale') await refreshStatus(tx, order.id)
      return { ok: true, id: line.id, revision: Number(order.revision) + 1 }
    }
    return catalogue || inTransaction ? await edit(ctx) : await ctx.tx(edit)
  } catch (error) {
    if (error instanceof LineEditRefused || error instanceof SaleRefused || error instanceof InventoryRefused)
      return error.result
    throw error
  }
}
