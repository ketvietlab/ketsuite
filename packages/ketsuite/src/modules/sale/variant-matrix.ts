import { createHash } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { queryVariants } from '../product/functions/variants.ts'
import { lockVariantTemplate } from '../product/variant-lifecycle.ts'
import { cataloguePrices, type CatalogueVariant } from './catalogue-prices.ts'
import { changeCatalogueQuantity } from './catalogue-quantity.ts'
import { ours } from './scope.ts'
import { invalid, SaleRefused } from './functions/shared.ts'

const local = (ctx: Ctx, row: Row) => !row.companyId || row.companyId === ctx.scope.company
const eligible = (ctx: Ctx, row: Row) =>
  local(ctx, row) &&
  row.active !== false &&
  row.saleOk !== false &&
  row.type !== 'combo' &&
  row.saleVariantMode === 'matrix' &&
  !!row.uomId

/** Menu metadata only. The selected template is read lazily by its own native modal. */
export async function variantMatrixTemplates(ctx: Ctx, orderId: unknown) {
  if (!(await ours(ctx, 'sale.Order', { id: orderId }))[0]) return null
  const products = (await ctx.db.select('product.Product')).filter(
    (row) => local(ctx, row) && row.active !== false,
  )
  return (await ctx.db.select('product.Template'))
    .filter((row) => eligible(ctx, row))
    .filter((row) => products.filter((product) => product.templateId === row.id).length >= 2)
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
}

/** Prices and units exactly match the first ordinary line used by the catalogue. */
export async function variantMatrix(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  if (!order || !template || !eligible(ctx, template)) return null
  const variants = (
    (await queryVariants(ctx, {
      templateId: template.id,
      active: true,
      saleOk: true,
      requireUom: true,
    })) as CatalogueVariant[]
  ).filter((row) => local(ctx, row))
  if (variants.length < 2) return null
  const lines = await ctx.db.select('product.TemplateAttributeLine', { templateId: template.id })
  const attributes = (await ctx.db.select('product.Attribute')).filter((row) => local(ctx, row))
  const values = (await ctx.db.select('product.AttributeValue')).filter((row) => local(ctx, row))
  const assigned = await ctx.db.select('product.TemplateAttributeValue')
  const bySequence = (a: Row, b: Row) =>
    Number(a.sequence ?? 10) - Number(b.sequence ?? 10) || String(a.name).localeCompare(String(b.name))
  // Match the order in the product's attribute editor, without reading its image attachments.
  const axes = attributes
    .filter(
      (attribute) =>
        attribute.createVariant !== 'no_variant' && lines.some((line) => line.attributeId === attribute.id),
    )
    .sort(bySequence)
    .map((attribute) => {
      const lineIds = new Set(
        lines.filter((line) => line.attributeId === attribute.id).map((line) => line.id),
      )
      const valueIds = new Set(
        assigned.filter((value) => lineIds.has(value.lineId)).map((value) => value.valueId),
      )
      return {
        id: String(attribute.id),
        name: String(attribute.name),
        values: values
          .filter((value) => valueIds.has(value.id))
          .sort(bySequence)
          .map((value) => ({ id: String(value.id), name: String(value.name) })),
      }
    })
  const prices = await cataloguePrices(ctx, order, variants)
  const rows: Array<Row & { values: Record<string, string> }> = prices.map((row) => ({
    ...row,
    values: Object.fromEntries(
      variants
        .find((variant) => variant.id === row.id)!
        .values.map((value) => [String(value.attributeId), String(value.valueId)]),
    ),
  }))
  const matrixRevision = createHash('sha256')
    .update(JSON.stringify([template.revisionId, axes, rows.map((row) => [row.id, row.values])]))
    .digest('hex')
  return {
    ok: true,
    order: {
      id: order.id,
      name: order.name,
      state: order.state,
      locked: order.locked,
      orderAuthority: order.orderAuthority,
      revision: order.revision,
    },
    template: { id: template.id, name: template.name },
    axes,
    rows,
    matrixRevision,
  }
}

/** Omitted cells stay untouched; every submitted cell succeeds or the entire batch rolls back. */
export async function saveVariantMatrix(ctx: Ctx, args: Row, inTransaction = false) {
  if (!Array.isArray(args.quantities) || args.quantities.length > 100)
    return invalid('quantities', 'sale.error.matrixInvalid')
  const seen = new Set<string>()
  const cells: { productId: string; quantity: string }[] = []
  for (const cell of args.quantities) {
    if (
      !cell ||
      typeof cell !== 'object' ||
      Array.isArray(cell) ||
      typeof cell.productId !== 'string' ||
      seen.has(cell.productId) ||
      Object.keys(cell).some((key) => !['productId', 'quantity'].includes(key)) ||
      typeof cell.quantity !== 'string'
    )
      return invalid('quantities', 'sale.error.matrixInvalid')
    const quantity = cell.quantity.trim() || '0'
    try {
      if (compareDecimals(quantity, '0') < 0) return invalid('quantities', 'sale.error.quantityPositive')
    } catch {
      return invalid('quantities', 'sale.error.matrixInvalid')
    }
    seen.add(cell.productId)
    cells.push({ productId: cell.productId, quantity })
  }
  try {
    const write = async (tx: Ctx) => {
      const initial = await variantMatrix(tx, args)
      if (!initial) return invalid('templateId', 'sale.error.matrixUnavailable')
      await lockVariantTemplate(tx, String(args.templateId))
      const matrix = await variantMatrix(tx, args)
      if (!matrix || matrix.matrixRevision !== args.matrixRevision)
        return invalid('matrixRevision', 'sale.error.matrixChanged')
      if (
        matrix.order.locked ||
        !['draft', 'sent', 'sale'].includes(String(matrix.order.state)) ||
        (matrix.order.orderAuthority != null && matrix.order.orderAuthority !== 'local')
      )
        return invalid('id', 'sale.error.lineNotEditable')
      if (Number(args.expectedRevision) !== Number(matrix.order.revision))
        return invalid('expectedRevision', 'sale.error.orderChanged')
      if (cells.some((cell) => !matrix.rows.some((row) => row.id === cell.productId)))
        return invalid('quantities', 'sale.error.matrixUnavailable')
      let revision = matrix.order.revision
      // Remove before adding, so a full 100-line order may exchange one eligible SKU atomically.
      for (const cell of [...cells].sort(
        (a, b) =>
          Number(compareDecimals(a.quantity, '0') !== 0) - Number(compareDecimals(b.quantity, '0') !== 0),
      )) {
        const result: Row = await changeCatalogueQuantity(
          tx,
          { id: args.id, ...cell, expectedRevision: revision },
          true,
        )
        if (!result.ok) throw new SaleRefused(result)
        revision = result.revision
      }
      return { ok: true, id: args.id, revision }
    }
    return inTransaction ? await write(ctx) : await ctx.tx(write)
  } catch (error) {
    if (error instanceof SaleRefused) return error.result
    throw error
  }
}
