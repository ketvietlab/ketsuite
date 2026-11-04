import { defineFn, deleteFrom, eq, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_READ_EFFECTS } from '../../user/authorization.ts'
import { holdsFunction } from '../../product/functions/shared.ts'
import { canonicalDecimalText, minorText, multiplyToMinor, scaleOf } from '../../account/money.ts'
import { currency, inUnit } from './shared.ts'
import {
  lockSupplierTemplate,
  projectSupplier,
  supplierIssue,
  supplierRevision,
  supplierRowsKey,
  supplierRows,
  SupplierRefused,
  touchSupplierTemplate,
} from '../product-supplier-policy.ts'

const readEffects = [
  ...AUTHORIZATION_READ_EFFECTS,
  'read:purchase.SupplierInfo',
  'read:product.Template',
  'read:partner.Partner',
  'read:product.Product',
  'read:uom.Unit',
  'read:company.Company',
]
const fields = new Set(['partnerId', 'productId', 'productCode', 'minQty', 'price', 'delay'])
const object = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const decimal = (value: unknown) => {
  const text = String(value ?? '0').trim()
  if (!/^\d+(?:\.\d+)?$/u.test(text) || !Number.isFinite(Number(text)))
    throw new SupplierRefused(supplierIssue('values'))
  return canonicalDecimalText(text)
}

export async function getProductSuppliersHandler(ctx: Ctx, args: Row) {
  const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
  if (!template) return null
  const held = await supplierRows(ctx, template.id)
  const money = await holdsFunction(ctx, 'product.listVariantCosts')
  return {
    revision: supplierRevision(template),
    rows: await Promise.all(held.map((row) => projectSupplier(ctx, template, row, money))),
    currency: await currency(ctx),
    money,
    editable:
      template.active !== false &&
      template.purchaseOk === true &&
      template.type !== 'combo' &&
      (await holdsFunction(ctx, 'purchase.applyProductSupplierGrid')),
  }
}

const fold = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLowerCase()
export async function listSupplierPartnersHandler(ctx: Ctx, args: Row) {
  const roles = await ctx.db.select('partner.Role', { role: 'supplier' })
  const suppliers = new Set(roles.map((row) => String(row.partnerId)))
  const search = fold(args.search).trim()
  return (await ctx.db.select('partner.Partner', {}))
    .filter(
      (row) => row.active !== false && (!search || fold(`${row.name} ${row.ref ?? ''}`).includes(search)),
    )
    .sort(
      (a, b) =>
        Number(suppliers.has(String(b.id))) - Number(suppliers.has(String(a.id))) ||
        String(a.name).localeCompare(String(b.name)) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, Math.max(1, Math.min(100, Number(args.limit) || 50)))
    .map((row) => ({ id: row.id, name: row.name, supplier: suppliers.has(String(row.id)) }))
}

/** A grid patch changes only offered fields; company, units, discounts and date validity stay server-owned. */
export async function applyProductSupplierGridHandler(ctx: Ctx, args: Row) {
  const changes = args.changes
  if (
    !object(changes) ||
    Object.keys(changes).some((key) => !['added', 'updated', 'removed', 'order'].includes(key)) ||
    !Array.isArray(changes.added) ||
    !Array.isArray(changes.updated) ||
    !Array.isArray(changes.removed) ||
    (changes.order !== null && !Array.isArray(changes.order))
  )
    return supplierIssue('invalid')
  const added = changes.added as Row[],
    updated = changes.updated as Row[],
    removed = changes.removed as unknown[]
  if (
    added.length + updated.length + removed.length > 60 ||
    [...added, ...updated].some(
      (entry) =>
        !object(entry) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        !object(entry.values) ||
        Object.keys(entry.values).some((key) => !fields.has(key)),
    ) ||
    removed.some((id) => typeof id !== 'string')
  )
    return supplierIssue('invalid')
  const touched = [...added.map((row) => row.id), ...updated.map((row) => row.id), ...removed]
  if (new Set(touched).size !== touched.length) return supplierIssue('duplicate')
  const money = await holdsFunction(ctx, 'product.listVariantCosts')
  if (!money && [...added, ...updated].some((row) => Object.hasOwn(row.values as Row, 'price')))
    throw new KetError({
      code: 'E_FN_NOT_PERMITTED',
      message: 'Supplier prices require product cost access.',
    })
  try {
    return await ctx.tx(async (tx) => {
      const template = await lockSupplierTemplate(tx, args.templateId)
      const held = await supplierRows(tx, template.id)
      const revision = supplierRevision(template)
      if (args.expectedRevision !== revision) return supplierIssue('conflict', 'expectedRevision')
      if (!touched.length && changes.order === null) return { ok: true, id: template.id, revision }
      const known = new Map(held.map((row) => [String(row.id), row]))
      if (
        [...updated.map((row) => row.id), ...removed].some((id) => !known.has(String(id))) ||
        added.some((row) => known.has(String(row.id)))
      )
        return supplierIssue('ownership')
      let ids = held.map((row) => String(row.id)).filter((id) => !removed.includes(id))
      const patches = new Map(updated.map((row) => [String(row.id), row.values as Row]))
      for (const row of added) {
        if (!Number.isInteger(row.index) || Number(row.index) < 0 || Number(row.index) > ids.length)
          return supplierIssue('invalid')
        ids.splice(Number(row.index), 0, String(row.id))
        patches.set(String(row.id), row.values as Row)
      }
      if (changes.order !== null) {
        const order = changes.order as unknown[]
        if (
          order.length !== ids.length ||
          new Set(order).size !== order.length ||
          order.some((id) => typeof id !== 'string' || !ids.includes(id))
        )
          return supplierIssue('invalid')
        ids = order as string[]
      }
      if (ids.length > 20) return supplierIssue('limit')
      const scale = scaleOf(await currency(tx))
      const planned: Row[] = []
      for (const [index, id] of ids.entries()) {
        const existing = known.get(id)
        const patch = patches.get(id) ?? {}
        const displayed = existing
          ? await projectSupplier(tx, template, existing, true)
          : { partnerId: '', productId: '', productCode: '', minQty: '0', price: '0', delay: 0 }
        const input = { ...displayed, ...patch }
        const partner = (await tx.db.select('partner.Partner', { id: input.partnerId }))[0]
        if (!partner || (partner.active === false && existing?.partnerId !== input.partnerId))
          throw new SupplierRefused(supplierIssue('partner'))
        const productId = input.productId == null || input.productId === '' ? null : String(input.productId)
        if (productId) {
          const product = (await tx.db.select('product.Product', { id: productId }))[0]
          if (
            !product ||
            product.templateId !== template.id ||
            (product.active === false && existing?.productId !== productId)
          )
            throw new SupplierRefused(supplierIssue('variant'))
        }
        const code = String(input.productCode ?? '').trim()
        const delay = Number(input.delay)
        if ([...code].length > 40 || !Number.isInteger(delay) || delay < 0 || delay > 365)
          throw new SupplierRefused(supplierIssue('values'))
        const minimum = decimal(input.minQty),
          price = decimal(input.price)
        const uomId = existing?.productUomId ?? template.uomId
        const rowMinimum =
          existing && minimum === decimal(displayed.minQty)
            ? existing.minQty
            : await inUnit(tx, Number(minimum), template.uomId, uomId)
        const factor = await inUnit(tx, 1, uomId, template.uomId)
        if (rowMinimum === null || factor === null) throw new SupplierRefused(supplierIssue('unit'))
        const rowPrice =
          existing && price === decimal(displayed.price)
            ? existing.price
            : minorText(multiplyToMinor([price, String(factor)], scale), scale)
        planned.push({
          ...(existing ?? {}),
          id: existing?.id ?? JSON.stringify([tx.scope.company, 'product-supplier', template.id, id]),
          productTemplateId: template.id,
          partnerId: partner.id,
          productId,
          productUomId: uomId,
          productCode: code || null,
          minQty: String(rowMinimum),
          price: String(rowPrice),
          delay,
          sequence:
            existing && !added.length && !removed.length && changes.order === null
              ? existing.sequence
              : index + 1,
          ...(!existing ? { productName: null, discount: '0', dateStart: null, dateEnd: null } : {}),
        })
      }
      // Compare persisted values before writing, so a no-op does not invalidate another open form.
      if (supplierRowsKey(planned) === supplierRowsKey(held)) return { ok: true, id: template.id, revision }
      for (const row of planned) {
        const existing = known.get(String(row.id))
        if (existing)
          await tx.db.update(
            'purchase.SupplierInfo',
            { id: row.id },
            Object.fromEntries([...fields, 'sequence'].map((field) => [field, row[field]])),
          )
        else {
          const inserted = await tx.db.insertIfAbsent('purchase.SupplierInfo', row)
          if (!('dryRun' in inserted) && !inserted.inserted)
            throw new SupplierRefused(supplierIssue('ownership'))
        }
      }
      const table = tx.table('purchase.SupplierInfo')
      for (const id of removed) await tx.db.del(deleteFrom(table).where(eq(table.id, String(id))))
      await touchSupplierTemplate(tx, template)
      const current = (await tx.db.select('product.Template', { id: template.id }))[0]!
      return { ok: true, id: template.id, revision: supplierRevision(current) }
    })
  } catch (error) {
    if (error instanceof SupplierRefused) return error.result
    throw error
  }
}

export const productSuppliersFunctions = {
  getProductSuppliers: defineFn({
    input: { templateId: 'id' },
    effects: readEffects,
    agent: true,
    handler: getProductSuppliersHandler,
  }),
  listSupplierPartners: defineFn({
    input: { search: 'text?', limit: 'int?' },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    agent: true,
    handler: listSupplierPartnersHandler,
  }),
  applyProductSupplierGrid: defineFn({
    input: { templateId: 'id', expectedRevision: 'text', changes: 'json' },
    output: { ok: 'bool', id: 'id?', revision: 'text?', errors: 'json?' },
    effects: [...readEffects, 'write:purchase.SupplierInfo', 'write:product.Template'],
    idempotent: true,
    agent: true,
    handler: applyProductSupplierGridHandler,
  }),
}
