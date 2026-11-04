import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { saveProductRecord } from './save-record.ts'
import { templateTagIds } from './tag-policy.ts'
import { lockVariantTemplate } from './variant-lifecycle.ts'
import { holdsFunction } from './functions/shared.ts'
import { companyScoped, importCatalogue } from './import-catalogue.ts'

export const bulkFields = [
  'categoryId',
  'addTag',
  'removeTag',
  'taxId',
  'listPrice',
  'saleOk',
  'purchaseOk',
  'saleDelay',
  'isStorable',
] as const
export type BulkField = (typeof bulkFields)[number]
export const bulkFieldLabels = {
  vi: {
    categoryId: 'Nhóm sản phẩm',
    addTag: 'Thêm thẻ',
    removeTag: 'Bỏ thẻ',
    taxId: 'Thuế',
    listPrice: 'Giá bán',
    saleOk: 'Có thể bán',
    purchaseOk: 'Có thể mua',
    saleDelay: 'Giao cho khách sau',
    isStorable: 'Theo dõi tồn',
  },
  en: {
    categoryId: 'Product group',
    addTag: 'Add tag',
    removeTag: 'Remove tag',
    taxId: 'Tax',
    listPrice: 'Sales price',
    saleOk: 'Can be sold',
    purchaseOk: 'Can be purchased',
    saleDelay: 'Customer lead days',
    isStorable: 'Track inventory',
  },
}
export class BulkEditRefused extends Error {
  readonly reason: string
  readonly product: string
  readonly field: string
  constructor(reason: string, product = '', field = '') {
    super(reason)
    this.reason = reason
    this.product = product
    this.field = field
  }
}
const refuse = (reason: string, product = '', field = ''): never => {
  throw new BulkEditRefused(reason, product, field)
}

function normalized(field: BulkField, value: unknown) {
  if (['saleOk', 'purchaseOk', 'isStorable'].includes(field)) {
    if (value !== 'true' && value !== 'false') return refuse('value', '', field)
    return value === 'true'
  }
  if (field === 'saleDelay') {
    if (!/^\d+$/.test(String(value).trim()) || Number(value) > 365) return refuse('value', '', field)
    return Number(value)
  }
  if (field === 'listPrice') {
    if (!/^\d+(?:\.\d+)?$/.test(String(value).trim())) return refuse('value', '', field)
    return String(value).trim()
  }
  if (value == null || !String(value).trim()) return refuse('value', '', field)
  return String(value).trim()
}

/** Caller owns the transaction. Compare canonical values before invoking the native record writer. */
async function patchFor(ctx: Ctx, row: Row, field: BulkField, value: unknown) {
  if (field === 'addTag' || field === 'removeTag') {
    const before = await templateTagIds(ctx, row.id)
    const after =
      field === 'addTag'
        ? [...new Set([...before, String(value)])].sort()
        : before.filter((id) => id !== value)
    return {
      before,
      after,
      changed: JSON.stringify(before) !== JSON.stringify(after),
      patch: { tagIds: after },
    }
  }
  if (field === 'taxId') {
    const before =
      (await ctx.db.select('account.ProductTax', { templateId: row.id, companyId: ctx.scope.company }))[0]
        ?.taxId ?? null
    return { before, after: value, changed: before !== value, patch: { taxId: value } }
  }
  const before =
    row[field] ?? (['saleOk', 'purchaseOk'].includes(field) ? true : field === 'isStorable' ? false : null)
  const changed =
    field === 'listPrice'
      ? before == null || compareDecimals(String(before), String(value)) !== 0
      : before !== value
  return {
    before,
    after: value,
    changed,
    patch: {
      [field]: value,
      ...(field === 'isStorable' ? { tracking: value ? (row.tracking ?? 'none') : 'none' } : {}),
    },
  }
}

export async function writeBulkEdit(ctx: Ctx, args: Row) {
  if (!ctx.scope.company) return refuse('company')
  const field = String(args.field) as BulkField
  if (!bulkFields.includes(field)) return refuse('field')
  const value = normalized(field, args.value)
  const selected = args.products as Array<{ id: string; revision: string }>
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > 200 ||
    selected.some((p) => !p || typeof p.id !== 'string' || !p.id || typeof p.revision !== 'string') ||
    new Set(selected.map((p) => p.id)).size !== selected.length
  )
    return refuse('selection')
  const products = [...selected].sort((a, b) => a.id.localeCompare(b.id))
  const request = { products, field, value }
  return ctx.tx(async (tx) => {
    const scope = { companyId: tx.scope.company }
    const sequenceId = `product-bulk:${tx.scope.company}`
    await tx.db.insertIfAbsent('product.BulkEditSequence', { id: sequenceId, value: 0, revision: 'initial' })
    const sequence = (await tx.db.select('product.BulkEditSequence', { ...scope, id: sequenceId }))[0]!
    const locked = await tx.db.compareAndSet(
      'product.BulkEditSequence',
      { id: sequenceId },
      { revision: sequence.revision },
      { revision: randomUUID() },
    )
    if (!('dryRun' in locked) && !locked.matched) return refuse('conflict')
    const previous = (await tx.db.select('product.BulkEdit', { ...scope, id: args.id }))[0]
    if (previous) {
      if (!isDeepStrictEqual(previous.request, request)) return refuse('replay')
      return {
        ok: true,
        id: previous.id,
        name: previous.name,
        productCount: previous.productCount,
        changedCount: previous.changedCount,
      }
    }
    const items: Row[] = []
    for (const selected of products) {
      const row = await lockVariantTemplate(tx, selected.id)
      // A catalogue kept per company (Commerce) holds the product to the active company; a shared
      // one has no company to compare.
      const elsewhere = companyScoped(tx, 'product.Template') && row?.companyId !== tx.scope.company
      if (!row || elsewhere || row.active === false) return refuse('missing', selected.id, field)
      const variants = await importCatalogue(tx, 'product.Product', { templateId: row.id })
      const code = String(
        row.variantCodeBase ?? variants.find((v) => !v.combinationKey)?.defaultCode ?? row.name,
      )
      if ((row.revisionId ?? 'initial') !== selected.revision) return refuse('conflict', code, field)
      const change = await patchFor(tx, row, field, value)
      if (!change.changed) continue
      const required = field === 'isStorable' ? 'stock.configureProduct' : 'product.saveTemplate'
      if (!(await holdsFunction(tx, required))) return refuse('permission', code, field)
      try {
        const result = await saveProductRecord(
          tx,
          {
            id: row.id,
            name: row.name,
            type: row.type,
            uomId: row.uomId,
            expectedRevisionId: selected.revision,
            ...change.patch,
          },
          { inTransaction: true },
        )
        if (!result.ok) {
          const issues = (result as Row).errors as Row[] | undefined
          return refuse(
            issues?.some((e) => String(e.code).includes('stockLocked')) ? 'locked' : 'value',
            code,
            field,
          )
        }
      } catch (error) {
        if (error instanceof BulkEditRefused) throw error
        if ((error as { code?: string }).code === 'E_FN_NOT_PERMITTED')
          return refuse('permission', code, field)
        if ((error as { code?: string }).code === 'conflict') return refuse('conflict', code, field)
        throw error
      }
      items.push({
        id: randomUUID(),
        bulkEditId: args.id,
        templateId: row.id,
        code,
        name: row.name,
        before: { value: change.before },
        after: { value: change.after },
      })
    }
    const choiceModel =
      field === 'categoryId'
        ? 'product.Category'
        : field === 'taxId'
          ? 'account.Tax'
          : ['addTag', 'removeTag'].includes(field)
            ? 'product.Tag'
            : null
    const choice = choiceModel ? (await tx.db.select(choiceModel, { id: value }))[0] : null
    const valueLabel = choice ? String(choice.name) : String(value)
    const number = Number(sequence.value) + 1
    const receipt = {
      id: args.id,
      name: `SUA/${String(number).padStart(4, '0')}`,
      actor: tx.actor ?? '',
      occurredAt: new Date().toISOString(),
      field,
      value: String(value),
      valueLabel,
      request,
      productCount: products.length,
      changedCount: items.length,
    }
    await tx.db.insert('product.BulkEdit', receipt)
    for (const item of items) await tx.db.insert('product.BulkEditItem', item)
    await tx.db.update('product.BulkEditSequence', { id: sequenceId }, { value: number })
    return {
      ok: true,
      id: receipt.id,
      name: receipt.name,
      productCount: receipt.productCount,
      changedCount: receipt.changedCount,
    }
  })
}
