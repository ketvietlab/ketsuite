import { cataloguePrices } from '../catalogue-prices.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { listVariantsHandler, variantsFunctions } from '../../product/functions/variants.ts'
import { linePriceFunctions } from '../../pricing/functions/line-price.ts'
import { lineUnitsFunctions } from './line-units.ts'
import { ours } from '../scope.ts'

type Variant = Row & { template: Row; values: Row[] }
const pageSize = 24
const invalid = () => ({ ok: false, errors: [{ field: 'filters', code: 'sale.error.catalogueFilters' }] })
const local = (ctx: Ctx, row: Row) => !row.companyId || row.companyId === ctx.scope.company

/** One order owns the price context; facets never contain another company's catalogue. */
export async function getCatalogue(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return null
  const selected = args.valueIds ?? []
  if (
    !Array.isArray(selected) ||
    selected.length > 50 ||
    selected.some((id) => typeof id !== 'string' || !id) ||
    new Set(selected).size !== selected.length ||
    String(args.search ?? '').length > 120
  )
    return invalid()
  const variants = (await listVariantsHandler(ctx, {
    active: true,
    saleOk: true,
    requireUom: true,
    search: args.search,
  })) as Variant[]
  // Product readers can span several granted companies; the order cannot.
  const templateRows = new Map(
    (await ctx.db.select('product.Template'))
      .filter((row) => local(ctx, row))
      .map((row) => [String(row.id), row]),
  )
  const candidates = variants.filter(
    (row) => local(ctx, row) && templateRows.has(String(row.templateId)) && row.template.type !== 'combo',
  )
  const categories = new Map(
    (await ctx.db.select('product.Category'))
      .filter((row) => local(ctx, row))
      .map((row) => [String(row.id), row]),
  )
  const inCategory = (row: Variant, id: unknown): boolean => {
    if (!id) return true
    const seen = new Set<string>()
    let current = String(row.template.categoryId ?? '')
    while (current && !seen.has(current)) {
      if (current === id) return true
      seen.add(current)
      current = String(categories.get(current)?.parentId ?? '')
    }
    return false
  }
  const attributes = new Map<string, { id: string; name: string; values: Map<string, string> }>()
  // Resolve selected values independently of search, so a zero-result search does
  // not turn a previously valid filter into an invalid request.
  const values = new Map(
    (await ctx.db.select('product.AttributeValue'))
      .filter((row) => local(ctx, row))
      .map((row) => [String(row.id), row]),
  )
  const attributeRows = new Map(
    (await ctx.db.select('product.Attribute'))
      .filter((row) => local(ctx, row))
      .map((row) => [String(row.id), row]),
  )
  const groups = new Map<string, Set<string>>()
  for (const id of selected as string[]) {
    const value = values.get(id)
    if (!value || !attributeRows.has(String(value.attributeId))) return invalid()
    const key = String(value.attributeId)
    const held = groups.get(key) ?? new Set<string>()
    held.add(id)
    groups.set(key, held)
  }
  if (args.categoryId && !categories.has(String(args.categoryId))) return invalid()
  const matchesAttributes = (row: Variant, except?: string) =>
    [...groups].every(
      ([attribute, ids]) =>
        attribute === except ||
        row.values.some((value) => value.attributeId === attribute && ids.has(String(value.valueId))),
    )
  for (const row of candidates)
    for (const value of row.values) {
      const id = String(value.attributeId)
      const group = attributes.get(id) ?? {
        id,
        name: String(value.attribute ?? ''),
        values: new Map<string, string>(),
      }
      group.values.set(String(value.valueId), String(value.value))
      attributes.set(id, group)
    }
  for (const id of selected as string[]) {
    const value = values.get(id)!,
      key = String(value.attributeId)
    const group = attributes.get(key) ?? {
      id: key,
      name: String(attributeRows.get(key)?.name ?? ''),
      values: new Map<string, string>(),
    }
    group.values.set(id, String(value.name))
    attributes.set(key, group)
  }
  // In listVariants' order, as the line picker shows them: by product, then sizes and other values in
  // their own order (S, M, L), not alphabetically.
  const filtered = candidates.filter((row) => inCategory(row, args.categoryId) && matchesAttributes(row))
  const page = Math.max(1, Math.min(100000, Number(args.page) || 1))
  const rows = await cataloguePrices(ctx, order, filtered.slice((page - 1) * pageSize, page * pageSize))
  const categoryName = (id: string) => {
    const names: string[] = [],
      seen = new Set<string>()
    let current = id
    while (current && categories.has(current) && !seen.has(current)) {
      seen.add(current)
      const category = categories.get(current)!
      names.unshift(String(category.name))
      current = String(category.parentId ?? '')
    }
    return names.join(' / ')
  }
  return {
    ok: true,
    order: {
      id: order.id,
      name: order.name,
      state: order.state,
      orderAuthority: order.orderAuthority,
      locked: order.locked,
      revision: order.revision,
      currency: order.currency,
    },
    rows,
    total: filtered.length,
    page,
    pageSize,
    categories: [...categories.keys()]
      .map((id) => ({
        id,
        name: categoryName(id),
        count: candidates.filter((row) => inCategory(row, id) && matchesAttributes(row)).length,
      }))
      .filter((category) => category.count > 0 || category.id === args.categoryId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    attributes: [...attributes.values()]
      .map((group) => ({
        id: group.id,
        name: group.name,
        values: [...group.values]
          .map(([id, name]) => ({
            id,
            name,
            count: candidates.filter(
              (row) =>
                inCategory(row, args.categoryId) &&
                matchesAttributes(row, group.id) &&
                row.values.some((value) => value.valueId === id),
            ).length,
          }))
          .filter((value) => value.count > 0 || selected.includes(value.id)),
      }))
      .filter((group) => group.values.length),
  }
}

export const getCatalogueHandler = (ctx: Ctx, args: Row) => getCatalogue(ctx, args)

export const catalogueFunctions = {
  getCatalogue: defineFn({
    input: { id: 'id', search: 'text?', categoryId: 'id?', valueIds: 'json?', page: 'int?' },
    effects: [
      ...variantsFunctions.listVariants!.effects!,
      ...lineUnitsFunctions.listLineUnits.effects!,
      ...linePriceFunctions.priceForLine.effects!,
      'read:company.Company',
      'read:sale.Order',
      'read:sale.OrderLine',
      'read:uom.Unit',
      'read:product.Category',
    ],
    agent: true,
    handler: getCatalogueHandler,
  }),
}
