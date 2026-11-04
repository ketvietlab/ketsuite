import { randomUUID } from 'node:crypto'
import { deleteFrom, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS } from '../user/authorization.ts'
import { BARCODE_EFFECTS, barcodeValue, claimBarcode, releaseBarcodeClaims } from './barcodes.ts'
import { claimProductCodeRevision } from './codes.ts'
import { holdsFunction } from './functions/shared.ts'

export const PACKAGING_GRID_READ_EFFECTS = [
  'read:product.Template',
  'read:product.Product',
  'read:product.TemplateUom',
  'read:product.ProductUom',
  'read:uom.Unit',
  ...AUTHORIZATION_READ_EFFECTS,
] as const
export const PACKAGING_GRID_WRITE_EFFECTS = [
  ...PACKAGING_GRID_READ_EFFECTS,
  ...BARCODE_EFFECTS,
  'write:product.Template',
  'write:product.TemplateUom',
  'write:product.ProductUom',
  'write:uom.Unit',
] as const

export type PackagingGridRow = { id: string; uomId: string; productId: string; barcode: string }
export type PackagingGridData = {
  revision: string
  editable: boolean
  singleProductId: string | null
  legacyOverlap: boolean
  rows: PackagingGridRow[]
  units: Array<{ value: string; label: string; active: boolean; quantity: number }>
}
type HeldRow = PackagingGridRow & { sequence: number; templateLink?: Row; productLink?: Row }

export class PackagingGridRefused extends Error {
  readonly result: Row
  constructor(code: string) {
    super(code)
    this.result = {
      ok: false,
      errors: [{ field: 'packagings', code: `product.error.packagingGrid.${code}` }],
    }
  }
}
function refuse(code: string): never {
  throw new PackagingGridRefused(code)
}
const root = (unit: Row): string =>
  String(unit.parentPath ?? '')
    .split('/')
    .filter(Boolean)[0] ?? ''
const pair = (productId: unknown, uomId: unknown): string => JSON.stringify([productId, uomId])
const overlaps = (a: PackagingGridRow, b: PackagingGridRow): boolean =>
  a.uomId === b.uomId && (a.productId === '*' || b.productId === '*' || a.productId === b.productId)
const wireRow = ({ id, uomId, productId, barcode }: PackagingGridRow): PackagingGridRow => ({
  id,
  uomId,
  productId,
  barcode,
})

async function heldPackagings(ctx: Ctx, templateId: unknown) {
  const template = (await ctx.db.select('product.Template', { id: templateId }))[0]
  if (!template) return null
  const products = await ctx.db.select('product.Product', { templateId })
  const ids = new Set(products.map((row) => String(row.id)))
  const templates = await ctx.db.select('product.TemplateUom', { templateId })
  const U = ctx.table('product.ProductUom')
  const productLinks = (
    ids.size ? await ctx.db.all(from(U).where(inArray(U.productId, [...ids]))) : []
  ).filter((row) => row.companyId === ctx.scope.company)
  const units = await ctx.db.select('uom.Unit')
  const singleProductId = products.length === 1 ? String(products[0]!.id) : null
  const consumed = new Set<string>()
  const rows: HeldRow[] = templates.map((link) => {
    const productLink = singleProductId
      ? productLinks.find((row) => row.productId === singleProductId && row.uomId === link.uomId)
      : undefined
    if (productLink) consumed.add(String(productLink.id))
    return {
      id: `template:${String(link.id)}`,
      uomId: String(link.uomId),
      productId: '*',
      barcode: barcodeValue(productLink?.barcode) ?? '',
      sequence: Number(link.sequence ?? 0),
      templateLink: link,
      productLink,
    }
  })
  for (const link of productLinks)
    if (!consumed.has(String(link.id)))
      rows.push({
        id: `product:${String(link.id)}`,
        uomId: String(link.uomId),
        productId: String(link.productId),
        barcode: barcodeValue(link.barcode) ?? '',
        sequence: Number(link.sequence ?? 0),
        productLink: link,
      })
  rows.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
  return { template, products, templates, productLinks, units, singleProductId, rows }
}

export async function productPackagingGrid(ctx: Ctx, templateId: unknown): Promise<PackagingGridData | null> {
  const held = await heldPackagings(ctx, templateId)
  if (held?.template.type !== 'goods') return null
  const base = held.units.find((row) => row.id === held.template.uomId)
  const linked = new Set(held.rows.map((row) => row.uomId))
  return {
    revision: String(held.template.revisionId ?? 'initial'),
    editable: held.template.active !== false && (await holdsFunction(ctx, 'product.savePackagingGrid')),
    singleProductId: held.singleProductId,
    legacyOverlap: held.rows.some((row, index) =>
      held.rows.slice(index + 1).some((other) => overlaps(row, other)),
    ),
    rows: held.rows.map(wireRow),
    units: held.units
      .filter(
        (unit) =>
          linked.has(String(unit.id)) ||
          (base && unit.id !== base.id && unit.active !== false && root(unit) === root(base)),
      )
      .map((unit) => ({
        value: String(unit.id),
        label: String(unit.name),
        active: unit.active !== false,
        quantity: base ? Number(unit.absoluteFactor) / Number(base.absoluteFactor) : 0,
      })),
  }
}

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return refuse('invalid')
  return value as Row
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) return refuse('invalid')
  return value
}
function changesOf(raw: unknown, held: HeldRow[]): PackagingGridRow[] {
  const serialized = JSON.stringify(raw)
  if (!serialized || serialized.length > 65536) refuse('invalid')
  const posted = object(raw)
  if (Object.keys(posted).some((key) => !['added', 'updated', 'removed', 'order'].includes(key)))
    refuse('invalid')
  const rows = new Map(held.map((row) => [row.id, wireRow(row)]))
  const touched = new Set<string>()
  const existing = (id: unknown) => {
    if (typeof id !== 'string' || !rows.has(id) || touched.has(id)) return refuse('conflict')
    touched.add(id)
    return rows.get(id)!
  }
  const values = (raw: unknown): Partial<PackagingGridRow> => {
    const value = object(raw)
    if (Object.keys(value).some((key) => !['uomId', 'productId', 'barcode'].includes(key))) refuse('invalid')
    const out: Partial<PackagingGridRow> = {}
    for (const key of ['uomId', 'productId', 'barcode'] as const)
      if (Object.hasOwn(value, key)) {
        if (value[key] != null && typeof value[key] !== 'string') refuse('invalid')
        out[key] = String(value[key] ?? '').trim()
      }
    return out
  }
  for (const id of list(posted.removed ?? [])) rows.delete(existing(id).id)
  for (const raw of list(posted.updated ?? [])) {
    const item = object(raw)
    Object.assign(existing(item.id), values(item.values))
  }
  for (const raw of list(posted.added ?? [])) {
    const item = object(raw)
    if (typeof item.id !== 'string' || !item.id || rows.has(item.id) || touched.has(item.id))
      refuse('invalid')
    touched.add(item.id)
    rows.set(item.id, { id: item.id, uomId: '', productId: '*', barcode: '', ...values(item.values) })
  }
  if (rows.size > 20) refuse('limit')
  if (posted.order == null) return [...rows.values()]
  const order = list(posted.order)
  if (
    order.length !== rows.size ||
    new Set(order).size !== rows.size ||
    order.some((id) => typeof id !== 'string' || !rows.has(id))
  )
    refuse('invalid')
  return order.map((id) => rows.get(String(id))!)
}

/** Caller-owned transaction; a parent record save has already claimed the template revision. */
export async function writeProductPackagingGrid(
  ctx: Ctx,
  templateId: unknown,
  changes: unknown,
): Promise<boolean> {
  if (!(await holdsFunction(ctx, 'product.savePackagingGrid')))
    throw new KetError({
      code: 'E_FN_NOT_PERMITTED',
      message: 'This role may not change product packagings.',
    })
  if (!ctx.scope.company) return refuse('company')
  const held = await heldPackagings(ctx, templateId)
  if (!held) return refuse('missing')
  if (held.template.type !== 'goods' || held.template.active === false) return refuse('unavailable')
  const rows = changesOf(changes, held.rows)
  if (JSON.stringify(rows) === JSON.stringify(held.rows.map(wireRow))) return false
  const base = held.units.find((unit) => unit.id === held.template.uomId)
  const previous = new Map(held.rows.map((row) => [row.id, row]))
  for (const [index, row] of rows.entries()) {
    const old = previous.get(row.id)
    const sameTarget = old?.uomId === row.uomId && old.productId === row.productId
    const unit = held.units.find((unit) => unit.id === row.uomId)
    if (
      !sameTarget &&
      (!base || !unit || unit.id === base.id || unit.active === false || root(unit) !== root(base))
    )
      refuse('unit')
    const product = held.products.find((product) => product.id === row.productId)
    if (row.productId !== '*' && (!product || (!sameTarget && product.active === false))) refuse('variant')
    if (row.barcode && row.productId === '*' && !held.singleProductId) refuse('barcodeVariant')
    for (const other of rows.slice(0, index))
      if (overlaps(row, other)) {
        const beforeOther = previous.get(other.id)
        // Retain an existing shared-unit / SKU-barcode pair. Do not create new overlaps.
        if (
          !sameTarget ||
          !beforeOther ||
          beforeOther.uomId !== other.uomId ||
          beforeOther.productId !== other.productId ||
          !old ||
          !overlaps(old, beforeOther)
        )
          refuse('overlap')
      }
  }
  const desiredTemplates = new Map<string, number>()
  const desiredProducts = new Map<
    string,
    { productId: string; uomId: string; barcode: string; sequence: number }
  >()
  for (const [sequence, row] of rows.entries()) {
    if (row.productId === '*') {
      desiredTemplates.set(row.uomId, sequence)
      if (held.singleProductId && row.barcode)
        desiredProducts.set(pair(held.singleProductId, row.uomId), {
          ...row,
          productId: held.singleProductId,
          sequence,
        })
    } else desiredProducts.set(pair(row.productId, row.uomId), { ...row, sequence })
  }
  // Release and clear all changing barcodes before claiming any: a batch can swap them.
  const changing = held.productLinks.filter((link) => {
    const wanted = desiredProducts.get(pair(link.productId, link.uomId))
    return !wanted || barcodeValue(link.barcode) !== barcodeValue(wanted.barcode)
  })
  await releaseBarcodeClaims(
    ctx,
    changing.map((link) => ({ kind: 'packaging' as const, id: String(link.id) })),
  )
  for (const link of changing) await ctx.db.update('product.ProductUom', { id: link.id }, { barcode: null })
  const T = ctx.table('product.TemplateUom'),
    P = ctx.table('product.ProductUom')
  for (const link of held.templates)
    if (!desiredTemplates.has(String(link.uomId))) await ctx.db.del(deleteFrom(T).where(eq(T.id, link.id)))
  for (const link of held.productLinks)
    if (!desiredProducts.has(pair(link.productId, link.uomId)))
      await ctx.db.del(deleteFrom(P).where(eq(P.id, link.id)))
  for (const [uomId, sequence] of desiredTemplates) {
    const link = held.templates.find((link) => link.uomId === uomId)
    if (link) await ctx.db.update('product.TemplateUom', { id: link.id }, { sequence })
    else await ctx.db.insert('product.TemplateUom', { id: randomUUID(), templateId, uomId, sequence })
  }
  for (const wanted of desiredProducts.values()) {
    const link = held.productLinks.find(
      (link) => link.productId === wanted.productId && link.uomId === wanted.uomId,
    )
    const id = link ? String(link.id) : randomUUID()
    const barcode = await claimBarcode(ctx, { kind: 'packaging', id }, link, wanted.barcode, {
      field: 'packagings',
    })
    if (link) await ctx.db.update('product.ProductUom', { id }, { ...barcode, sequence: wanted.sequence })
    else
      await ctx.db.insert('product.ProductUom', {
        id,
        productId: wanted.productId,
        uomId: wanted.uomId,
        ...barcode,
        sequence: wanted.sequence,
      })
  }
  for (const uomId of new Set(rows.map((row) => row.uomId)))
    await ctx.db.update('uom.Unit', { id: uomId }, { locked: true })
  return true
}

export async function saveProductPackagingGrid(ctx: Ctx, args: Row): Promise<Row> {
  return ctx.tx(async (tx) => {
    const template = (await tx.db.select('product.Template', { id: args.templateId }))[0]
    if (!template) return refuse('missing')
    if (args.expectedRevisionId !== (template.revisionId ?? 'initial')) return refuse('conflict')
    await claimProductCodeRevision(tx, template)
    await writeProductPackagingGrid(tx, args.templateId, args.changes)
    return { ok: true, id: args.templateId }
  })
}
