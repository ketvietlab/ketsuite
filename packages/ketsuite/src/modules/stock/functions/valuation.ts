import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'
import {
  accountingSettingKey,
  accountingSettingOf,
  moneyMinor,
  OWNED,
  priced,
  scaleFor,
  share,
  units,
  unitsText,
} from '../valuation.ts'
import { minorText } from '../../account/money.ts'
import { pickingRevaluations, revaluableMoves } from './revaluation.ts'

const refusal = (field: string, key: string) => ({
  ok: false,
  errors: [{ field, messageKey: `stock.error.${key}` }],
})

const ACCOUNT_FIELDS = [
  'valuationAccountId',
  'supplierAccountId',
  'productionAccountId',
  'cogsAccountId',
  'gainAccountId',
  'lossAccountId',
] as const
// K7: what shipping posts to. Optional: a company that ships nothing values its stock without them.
export const DELIVERY_ACCOUNT_FIELDS = [
  'deliveryFeeAccountId',
  'carrierCodAccountId',
  'receivableAccountId',
  'carrierPayableAccountId',
] as const
const SETTING_FIELDS = ['journalId', ...ACCOUNT_FIELDS, ...DELIVERY_ACCOUNT_FIELDS] as const

export async function getAccountingSettingHandler(ctx: Ctx) {
  const held = await accountingSettingOf(ctx)
  return {
    accounting: Boolean(ctx.manifest.models['account.Move']),
    ...Object.fromEntries(SETTING_FIELDS.map((field) => [field, held?.[field] ?? null])),
  }
}

export async function saveAccountingSettingHandler(ctx: Ctx, args: Row) {
  const held = await accountingSettingOf(ctx)
  const values = Object.fromEntries(
    SETTING_FIELDS.map((field) => [
      field,
      // A form without the shipping accounts keeps them.
      (args[field] === undefined && (DELIVERY_ACCOUNT_FIELDS as readonly string[]).includes(field)
        ? held?.[field]
        : String(args[field] ?? '').trim()) || null,
    ]),
  ) as Record<(typeof SETTING_FIELDS)[number], string | null>
  if (values.journalId) {
    if (!ctx.manifest.models['account.Move']) return refusal('journalId', 'valuationJournalInvalid')
    const journal = (await ctx.db.select('account.Journal', { id: values.journalId }))[0]
    if (!journal || journal.active === false || journal.type !== 'general')
      return refusal('journalId', 'valuationJournalInvalid')
    // Posting needs every account: a missing one would only surface when a transfer completes.
    for (const field of ACCOUNT_FIELDS) if (!values[field]) return refusal(field, 'valuationAccountMissing')
  }
  for (const field of [...ACCOUNT_FIELDS, ...DELIVERY_ACCOUNT_FIELDS]) {
    if (!values[field]) continue
    const account = ctx.manifest.models['account.Account']
      ? (await ctx.db.select('account.Account', { id: values[field] }))[0]
      : undefined
    if (!account || account.active === false) return refusal(field, 'valuationAccountInvalid')
  }
  const id = accountingSettingKey(ctx)
  if (held) await ctx.db.update('stock.AccountingSetting', { id }, values)
  else await ctx.db.insert('stock.AccountingSetting', { id, ...values })
  return { ok: true, id }
}

const fold = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
const SORTS = ['code', 'name', 'quantity', 'averageCost', 'value'] as const

export type HeldValuation = {
  productId: string
  code: string | null
  name: string
  uomName: string | null
  /** What the company holds across its owned locations, in millionths of the product unit. */
  quantity: bigint
  /** What that stock is worth, in minor units of the company currency. */
  value: bigint
}

/**
 * K26: each storable product the company holds and what it is worth at the running average. A product no
 * transfer has touched since valuation began opens at its catalogue cost.
 */
export async function heldValuations(ctx: Ctx, scale: number): Promise<HeldValuation[]> {
  const owned = new Set(
    (await ours(ctx, 'stock.Location'))
      .filter((row) => OWNED.includes(String(row.usage)))
      .map((row) => String(row.id)),
  )
  const companyHeld = new Map<string, bigint>()
  for (const quant of await ours(ctx, 'stock.Quant')) {
    if (!owned.has(String(quant.locationId))) continue
    const productId = String(quant.productId)
    companyHeld.set(productId, (companyHeld.get(productId) ?? 0n) + units(quant.quantity))
  }
  const valuations = new Map(
    (await ours(ctx, 'stock.ProductValuation')).map((row) => [String(row.productId), row] as const),
  )
  const held: HeldValuation[] = []
  for (const productId of new Set([...companyHeld.keys(), ...valuations.keys()])) {
    const product = (await ctx.db.select('product.Product', { id: productId }))[0]
    const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    if (!template?.isStorable) continue
    const valuation = valuations.get(productId)
    const cost = (await ours(ctx, 'product.Cost', { productId }))[0]?.standardPrice ?? '0'
    const quantity = valuation ? units(valuation.quantity) : (companyHeld.get(productId) ?? 0n)
    if (quantity <= 0n) continue
    const unit = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : undefined
    held.push({
      productId,
      code: product.defaultCode == null ? null : String(product.defaultCode),
      name: String(template.name),
      uomName: unit?.name == null ? null : String(unit.name),
      quantity,
      value: valuation ? moneyMinor(valuation.value, scale) : priced(cost, quantity, scale),
    })
  }
  return held
}

export const heldValuationEffects = [
  'read:stock.Location',
  'read:stock.Quant',
  'read:stock.ProductValuation',
  'read:product.Product',
  'read:product.Template',
  'read:product.Cost',
  'read:uom.Unit',
  'read:company.Company',
] as const

/**
 * K26: what the company's stock is worth, one row per product held. Without a warehouse filter the
 * total equals the goods account; a warehouse shows its quantity at the company average and the
 * proportional share of value.
 */
export async function listValuationHandler(ctx: Ctx, args: Row) {
  const scale = await scaleFor(ctx)
  const warehouseId = args.warehouseId ? String(args.warehouseId) : null
  const search = String(args.search ?? '').trim()
  const requestedSort = String(args.sort ?? 'code')
  const bare = requestedSort.replace(/^-/, '')
  const sortKey = (SORTS as readonly string[]).includes(bare) ? bare : 'code'
  const descending = sortKey === bare && requestedSort.startsWith('-')
  const sort = `${descending ? '-' : ''}${sortKey}`
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(args.pageSize) || 50)))

  const owned = new Map(
    (await ours(ctx, 'stock.Location'))
      .filter((row) => OWNED.includes(String(row.usage)))
      .map((row) => [String(row.id), row] as const),
  )
  const warehouseHeld = new Map<string, bigint>()
  if (warehouseId)
    for (const quant of await ours(ctx, 'stock.Quant')) {
      if (String(owned.get(String(quant.locationId))?.warehouseId ?? '') !== warehouseId) continue
      const productId = String(quant.productId)
      warehouseHeld.set(productId, (warehouseHeld.get(productId) ?? 0n) + units(quant.quantity))
    }
  const all: Row[] = []
  for (const held of await heldValuations(ctx, scale)) {
    const quantity = warehouseId ? (warehouseHeld.get(held.productId) ?? 0n) : held.quantity
    if (quantity <= 0n) continue
    all.push({
      productId: held.productId,
      code: held.code,
      name: held.name,
      quantity: unitsText(quantity),
      uomName: held.uomName,
      averageCost: minorText(share(held.value, 1_000_000n, held.quantity), scale),
      value: minorText(warehouseId ? share(held.value, quantity, held.quantity) : held.value, scale),
    })
  }
  const needle = fold(search)
  const matched = needle
    ? all.filter((row) => fold(`${row.code ?? ''} ${row.name ?? ''}`).includes(needle))
    : all
  const numeric = sortKey !== 'code' && sortKey !== 'name'
  matched.sort((a, b) => {
    const order = numeric
      ? Number(a[sortKey]) - Number(b[sortKey])
      : String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'vi')
    return (descending ? -order : order) || String(a.productId).localeCompare(String(b.productId))
  })
  const total = matched.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(args.page) || 1)))
  const totalValue = matched.reduce((sum, row) => sum + moneyMinor(row.value, scale), 0n)
  const currency = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null
  return {
    query: { warehouseId, search, sort, page, pageSize },
    currency,
    total,
    page,
    pages,
    rows: matched.slice((page - 1) * pageSize, page * pageSize),
    totalValue: minorText(totalValue, scale),
    isEmpty: all.length === 0,
  }
}

/** K25: value of each completed line of a transfer and the stock-journal entry that booked it. */
export async function getPickingValuationHandler(ctx: Ctx, args: Row) {
  const picking = (await ours(ctx, 'stock.Picking', { id: args.id }))[0]
  if (!picking) return null
  const scale = await scaleFor(ctx)
  const layers = await ours(ctx, 'stock.ValuationLayer', { pickingId: picking.id })
  const magnitude = (value: unknown) => {
    const minor = moneyMinor(value, scale)
    return minor < 0n ? -minor : minor
  }
  const accountMoveId = layers.find((row) => row.accountMoveId)?.accountMoveId ?? null
  const entry =
    accountMoveId && ctx.manifest.models['account.Move']
      ? (await ctx.db.select('account.Move', { id: accountMoveId }))[0]
      : undefined
  // K24: an open receipt shows each line's unit cost, defaulting to the average it would take now.
  const drafts: Row[] = []
  if (!['done', 'cancel'].includes(String(picking.state)))
    for (const move of await ours(ctx, 'stock.Move', { pickingId: picking.id })) {
      const held = (await ours(ctx, 'stock.ProductValuation', { productId: move.productId }))[0]
      const cost = (await ours(ctx, 'product.Cost', { productId: move.productId }))[0]?.standardPrice ?? null
      const averageCost =
        held && units(held.quantity) > 0n
          ? minorText(share(moneyMinor(held.value, scale), 1_000_000n, units(held.quantity)), scale)
          : cost == null
            ? null
            : String(cost)
      for (const line of await ours(ctx, 'stock.MoveLine', { moveId: move.id }))
        drafts.push({
          moveLineId: line.id,
          unitCost: line.unitCost ?? move.priceUnit ?? null,
          averageCost,
        })
    }
  return {
    id: picking.id,
    currency: (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]?.currency ?? null,
    drafts,
    lines: layers.map((row) => ({
      moveLineId: row.moveLineId,
      productId: row.productId,
      kind: row.kind,
      quantity: unitsText(units(row.quantity) < 0n ? -units(row.quantity) : units(row.quantity)),
      unitCost: row.unitCost,
      value: minorText(magnitude(row.value), scale),
    })),
    total: minorText(
      layers.reduce((sum, row) => sum + magnitude(row.value), 0n),
      scale,
    ),
    accountMoveId: entry ? entry.id : null,
    accountMoveName: entry ? entry.name : null,
    // K63: what the receipt's value was adjusted by since, and the lines an adjustment may name.
    revaluations: await pickingRevaluations(ctx, picking),
    revaluable: await Promise.all(
      (await revaluableMoves(ctx, picking)).map(async (move) => {
        const product = (await ctx.db.select('product.Product', { id: move.productId }))[0]
        const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
        return {
          moveId: move.id,
          label: `${product?.defaultCode ? `[${String(product.defaultCode)}] ` : ''}${String(template?.name ?? '')}`,
        }
      }),
    ),
  }
}

const PRICE = /^\d+(\.\d+)?$/

/** K24: the receipt price per unit, set by a manager before the receipt completes. */
export async function setReceiptUnitCostHandler(ctx: Ctx, args: Row) {
  const line = (await ours(ctx, 'stock.MoveLine', { id: args.id }))[0]
  if (!line) return refusal('id', 'receiptUnitCostOnly')
  const move = (await ours(ctx, 'stock.Move', { id: line.moveId }))[0]
  const picking = move?.pickingId ? (await ours(ctx, 'stock.Picking', { id: move.pickingId }))[0] : undefined
  if (!move || !picking || ['done', 'cancel'].includes(String(picking.state)))
    return refusal('id', 'receiptUnitCostOnly')
  const usage = async (id: unknown) => (await ours(ctx, 'stock.Location', { id }))[0]?.usage
  if (
    !['supplier', 'production'].includes(String(await usage(move.locationId))) ||
    !OWNED.includes(String(await usage(move.locationDestId)))
  )
    return refusal('id', 'receiptUnitCostOnly')
  const text = String(args.unitCost ?? '').trim()
  if (text && !PRICE.test(text)) return refusal('unitCost', 'receiptUnitCostInvalid')
  const unitCost = text ? text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : null
  if (String(line.unitCost ?? '') !== String(unitCost ?? ''))
    await ctx.db.update('stock.MoveLine', { id: line.id }, { unitCost })
  return { ok: true, id: line.id, unitCost }
}

export const valuationFunctions: Record<string, FnSpec> = {
  getAccountingSetting: defineFn({
    input: {},
    effects: ['read:stock.AccountingSetting'],
    agent: true,
    handler: getAccountingSettingHandler,
  }),
  saveAccountingSetting: defineFn({
    input: {
      journalId: 'text?',
      valuationAccountId: 'text?',
      supplierAccountId: 'text?',
      productionAccountId: 'text?',
      cogsAccountId: 'text?',
      gainAccountId: 'text?',
      lossAccountId: 'text?',
      deliveryFeeAccountId: 'text?',
      carrierCodAccountId: 'text?',
      receivableAccountId: 'text?',
      carrierPayableAccountId: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.AccountingSetting',
      'write:stock.AccountingSetting',
      'read:account.Journal',
      'read:account.Account',
    ],
    idempotent: true,
    agent: true,
    handler: saveAccountingSettingHandler,
  }),
  listValuation: defineFn({
    input: { warehouseId: 'id?', search: 'text?', sort: 'text?', page: 'int?', pageSize: 'int?' },
    effects: [
      'read:stock.Location',
      'read:stock.Quant',
      'read:stock.ProductValuation',
      'read:product.Product',
      'read:product.Template',
      'read:product.Cost',
      'read:uom.Unit',
      'read:company.Company',
    ],
    agent: true,
    handler: listValuationHandler,
  }),
  getPickingValuation: defineFn({
    input: { id: 'id' },
    effects: [
      'read:stock.Picking',
      'read:stock.Move',
      'read:stock.MoveLine',
      'read:stock.ValuationLayer',
      'read:stock.ProductValuation',
      'read:product.Cost',
      'read:account.Move',
      'read:stock.Revaluation',
      'read:product.Product',
      'read:product.Template',
      'read:company.Company',
    ],
    agent: true,
    handler: getPickingValuationHandler,
  }),
  setReceiptUnitCost: defineFn({
    input: { id: 'id', unitCost: 'text?' },
    output: { ok: 'bool', id: 'id?', unitCost: 'text?', errors: 'json?' },
    effects: [
      'read:stock.MoveLine',
      'write:stock.MoveLine',
      'read:stock.Move',
      'read:stock.Picking',
      'read:stock.Location',
    ],
    idempotent: true,
    agent: true,
    handler: setReceiptUnitCostHandler,
  }),
}
