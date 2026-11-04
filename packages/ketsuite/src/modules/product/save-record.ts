import { PackagingGridRefused, writeProductPackagingGrid } from './packaging-grid.ts'
import { barcodeFailure } from './barcodes.ts'
import { saveProductTax } from '../account/product-tax.ts'
import {
  tagIdsOf,
  tagFailure,
  templateTagIds,
  validateTemplateTags,
  writeTemplateTags,
} from './tag-policy.ts'
import { LotRefused, shelfLifeFields, shelfLifePatch } from '../stock/lot-policy.ts'
import { comboFailure, comboRefusal } from './combo-policy.ts'
import { comboIdsOf, templateComboIds, validateTemplateCombos } from './template-combos.ts'
import { hasPhysicalStock, stockLocked } from './stock-policy.ts'
// P17: "Save changes" on the product page is one command. The general fields, the
// stock setup (barcode, stock tracking) and the accounting fields (cost) are written
// in one transaction under one revision, so a refused or failed group leaves none of
// the others half saved. Each group is opened by the function that edits it alone,
// and a changed value in a group the caller does not hold is refused with 403 before
// anything is written.

import { KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { barcodeOf, companyKey, holdsFunction } from './functions/shared.ts'
import { saveTemplateFunction } from './functions/templates.ts'
import { setProductAccountsFunction } from '../account/functions/product-accounts.ts'

const templateSave = saveTemplateFunction({ inTransaction: true })
const accountSave = setProductAccountsFunction({ inTransaction: true })

/** The values stock.configureProduct accepts; the stock module owns the columns. */
const TRACKING = ['none', 'lot', 'serial']

// Every template field the save writes: a field missing here would be written for a
// role that holds only the stock or accounting group.
const GENERAL_TEMPLATE_FIELDS = [
  'name',
  'uomId',
  'categoryId',
  'brandId',
  'origin',
  'description',
  'listPrice',
  'compareAtPrice',
  'saleOk',
  'saleVariantMode',
  'purchaseOk',
  'saleDelay',
  'summaryDoc',
  'descriptionDoc',
  'saleWarning',
] as const
const GENERAL_VARIANT_FIELDS = ['defaultCode', 'weight', 'volume'] as const
const AMOUNTS = new Set(['listPrice', 'compareAtPrice', 'weight', 'volume', 'saleDelay'])
const FLAGS = new Set(['saleOk', 'purchaseOk'])
const DOCUMENTS = new Set(['summaryDoc', 'descriptionDoc'])

const amountOf = (value: unknown, blank: number | null = null): number | null =>
  value == null || String(value).trim() === '' ? blank : Number(value)
const textOf = (value: unknown): string | null =>
  value == null || String(value).trim() === '' ? null : String(value).trim()
/** A stored or submitted document as one JSON text, so the same content compares equal. */
const documentOf = (value: unknown): string | null => {
  if (value == null || String(value).trim() === '') return null
  try {
    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value)
  } catch {
    return String(value)
  }
}

/** Whether a submitted value differs from the stored one, in the form each is stored. */
const differs = (field: string, submitted: unknown, stored: unknown): boolean => {
  if (FLAGS.has(field)) return Boolean(submitted) !== Boolean(stored ?? true)
  if (DOCUMENTS.has(field)) return documentOf(submitted) !== documentOf(stored)
  if (AMOUNTS.has(field)) {
    // A measure left empty is stored as 0; a price left empty is none.
    const blank = field === 'weight' || field === 'volume' ? 0 : null
    return amountOf(submitted, blank) !== amountOf(stored, blank)
  }
  if (field === 'hsCode')
    return String(submitted ?? '').replace(/[\s.]/g, '') !== String(stored ?? '').replace(/[\s.]/g, '')
  return textOf(submitted) !== textOf(stored)
}

class Refused extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('refused')
    this.result = result
  }
}

export async function saveProductRecord(
  ctx: Ctx,
  args: Record<string, unknown>,
  options: { inTransaction?: boolean } = {},
) {
  const existing = (await ctx.db.select('product.Template', { id: args.id }))[0]
  if (args.duplicateSourceId) {
    if (
      !(await holdsFunction(ctx, 'product.duplicateTemplate')) ||
      !(await holdsFunction(ctx, 'product.getTemplate'))
    )
      throw new KetError({ code: 'E_FN_NOT_PERMITTED', message: 'this role may not duplicate products' })
    if (existing || !(await ctx.db.select('product.Template', { id: args.duplicateSourceId }))[0])
      return { ok: false, errors: [{ field: 'duplicateSourceId', code: 'product.error.duplicate.missing' }] }
  }
  const products = existing ? await ctx.db.select('product.Product', { templateId: args.id }) : []
  const defaultVariant = products.find((product) => String(product.combinationKey) === '')
  const generated = products.some(
    (product) => String(product.combinationKey) !== '' && product.active !== false,
  )
  const costProductId = defaultVariant?.id ?? `${String(args.id)}:default`
  const stocked = Boolean(ctx.manifest.modules.stock)
  const inventory = Object.hasOwn(args, 'isStorable')
  let shelfLife: Row
  try {
    shelfLife = shelfLifePatch(args)
  } catch (error) {
    if (error instanceof LotRefused) return error.result
    throw error
  }
  const shelfLifeChanged = Object.keys(shelfLife).filter(
    (field) => shelfLife[field] !== (existing?.[field] ?? null),
  )
  const costing = Object.hasOwn(args, 'costPrice') && args.costPrice != null
  const accountFields = ['incomeAccountId', 'expenseAccountId'].filter((field) => Object.hasOwn(args, field))
  const accountInstalled = Boolean(ctx.manifest.modules.account)
  if (accountFields.length && !accountInstalled)
    return { ok: false, errors: [{ field: accountFields[0], message: 'account is not installed' }] }
  const productAccounts =
    accountFields.length && existing
      ? (await ctx.db.select('account.ProductAccount', { templateId: args.id }))[0]
      : null

  const taxRequested = Object.hasOwn(args, 'taxId')
  if (taxRequested && !accountInstalled)
    return { ok: false, errors: [{ field: 'taxId', code: 'product.error.import.choice' }] }
  const productTax =
    taxRequested && existing
      ? (await ctx.db.select('account.ProductTax', { templateId: args.id, companyId: ctx.scope.company }))[0]
      : null
  const taxChanged = taxRequested && textOf(args.taxId) !== textOf(productTax?.taxId)

  if ((inventory || shelfLifeChanged.length) && !stocked)
    return { ok: false, errors: [{ field: 'isStorable', message: 'stock is not installed' }] }
  if (costing && generated)
    return { ok: false, errors: [{ field: 'costPrice', code: 'product.error.template.costPerVariant' }] }
  if (costing && !ctx.scope.company)
    return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi giá vốn' }] }
  const isStorable = Boolean(args.isStorable)
  const tracking = String(args.tracking ?? 'none')
  if (
    (existing?.type ?? args.type) === 'combo' &&
    (isStorable || tracking !== 'none' || shelfLifeChanged.length || costing)
  )
    return comboRefusal('isStorable', 'noStock')
  if (inventory && (!TRACKING.includes(tracking) || (!isStorable && tracking !== 'none')))
    return { ok: false, errors: [{ field: 'tracking', code: 'product.error.template.tracking' }] }
  const costId = ctx.scope.company ? companyKey(ctx.scope.company, costProductId) : null
  const cost = costId ? (await ctx.db.select('product.Cost', { id: costId }))[0] : undefined

  // Which groups this save changes, each with the function that opens it.
  const changed: Array<{ fnKey: string; fields: string[] }> = []
  const changedAccounts = accountFields.filter(
    (field) => textOf(args[field]) !== textOf(productAccounts?.[field]),
  )
  if (changedAccounts.length) changed.push({ fnKey: 'account.setProductAccounts', fields: changedAccounts })
  const general = existing
    ? [
        ...GENERAL_TEMPLATE_FIELDS.filter(
          (field) => Object.hasOwn(args, field) && differs(field, args[field], existing[field]),
        ),
        ...GENERAL_VARIANT_FIELDS.filter(
          (field) => Object.hasOwn(args, field) && differs(field, args[field], defaultVariant?.[field]),
        ),
      ]
    : ['name']
  if (Object.hasOwn(args, 'tagIds')) {
    try {
      const held = existing ? await templateTagIds(ctx, args.id) : []
      if (JSON.stringify(tagIdsOf(args.tagIds)) !== JSON.stringify(held)) general.push('tagIds')
    } catch (error) {
      const refused = tagFailure(error)
      if (refused) return refused
      throw error
    }
  }
  if (taxChanged) general.push('taxId')
  if (general.length) changed.push({ fnKey: 'product.saveTemplate', fields: general })
  if (Object.hasOwn(args, 'comboIds')) {
    try {
      const held = existing ? await templateComboIds(ctx, args.id) : []
      if (JSON.stringify(comboIdsOf(args.comboIds)) !== JSON.stringify(held))
        changed.push({ fnKey: 'product.saveTemplate', fields: ['comboIds'] })
    } catch (error) {
      const refused = comboFailure(error)
      if (refused) return refused
      throw error
    }
  }
  if (Object.hasOwn(args, 'barcode') && barcodeOf(args.barcode) !== barcodeOf(defaultVariant?.barcode))
    changed.push({ fnKey: 'product.setBarcode', fields: ['barcode'] })
  // The HS code goes with the barcode in the stock setup, on the template as on a variant (P17, P28).
  if (Object.hasOwn(args, 'hsCode') && differs('hsCode', args.hsCode, existing?.hsCode))
    changed.push({ fnKey: 'product.setBarcode', fields: ['hsCode'] })
  if (
    inventory &&
    (!existing ||
      isStorable !== Boolean(existing.isStorable) ||
      tracking !== String(existing.tracking ?? 'none'))
  )
    changed.push({ fnKey: 'stock.configureProduct', fields: ['isStorable', 'tracking'] })
  if (shelfLifeChanged.length) changed.push({ fnKey: 'stock.configureProduct', fields: shelfLifeChanged })
  const costChanged = costing && amountOf(args.costPrice) !== amountOf(cost?.standardPrice)
  if (costChanged) changed.push({ fnKey: 'product.setCost', fields: ['costPrice'] })
  const missing: typeof changed = []
  for (const group of changed) if (!(await holdsFunction(ctx, group.fnKey))) missing.push(group)
  if (missing.length)
    throw new KetError({
      code: 'E_FN_NOT_PERMITTED',
      message: `this role may not change ${missing.flatMap((group) => group.fields).join(', ')}`,
      hint: `grant ${missing.map((group) => group.fnKey).join(', ')}, or leave those values as they are`,
    })

  if (!existing && !String(args.defaultCode ?? '').trim())
    return { ok: false, errors: [{ field: 'defaultCode', code: 'product.error.template.codeRequired' }] }
  const {
    taxId: _tax,
    costPrice: _cost,
    isStorable: _stored,
    tracking: _tracking,
    incomeAccountId: _income,
    expenseAccountId: _expense,
    duplicateSourceId: _source,
    packagings: _packagings,
    ...templateArgs
  } = args
  for (const field of shelfLifeFields) delete templateArgs[field]
  try {
    const write = async (tx: Ctx) => {
      if (args.duplicateSourceId && args.type === 'combo') {
        templateArgs.comboIds ??= await templateComboIds(tx, args.duplicateSourceId)
        await validateTemplateCombos(tx, args.id, templateArgs.comboIds)
      }
      // A create-from-source may retain that source's archived tags, under duplicate permission.
      // Lock tags before the category, just as ordinary assignment and direct duplication do.
      const copiedTags = args.duplicateSourceId
        ? await validateTemplateTags(
            tx,
            args.duplicateSourceId,
            args.tagIds ?? (await templateTagIds(tx, args.duplicateSourceId)),
          )
        : null
      if (copiedTags) delete templateArgs.tagIds
      // The template save checks the revision, the locks and the values, and stamps a
      // new revision: a page opened before this save cannot save over any group of it.
      const saved = (await templateSave.handler(tx, templateArgs)) as Row
      if (!saved.ok) throw new Refused(saved)
      if (Object.hasOwn(args, 'packagings')) await writeProductPackagingGrid(tx, args.id, args.packagings)
      if (copiedTags) await writeTemplateTags(tx, args.id, copiedTags)
      if (taxChanged) {
        const mapped = await saveProductTax(tx, { templateId: args.id, taxId: args.taxId })
        if (!mapped.ok) throw new Refused(mapped)
      }
      const inventoryFields =
        existing && inventory
          ? [
              ...(isStorable !== Boolean(existing.isStorable) ? ['isStorable'] : []),
              ...(tracking !== String(existing.tracking ?? 'none') ? ['tracking'] : []),
            ]
          : []
      if (
        inventoryFields.length &&
        (await hasPhysicalStock(
          tx,
          products.map((product) => String(product.id)),
        ))
      )
        throw new Refused(stockLocked(inventoryFields))
      if (costChanged && (await hasPhysicalStock(tx, [String(costProductId)])))
        throw new Refused(stockLocked(['costPrice']))
      if (costChanged && (!Number.isFinite(Number(args.costPrice)) || Number(args.costPrice) < 0))
        throw new Refused({
          ok: false,
          errors: [{ field: 'costPrice', code: 'product.error.template.costPositive' }],
        })
      if (costChanged) {
        if (cost) await tx.db.update('product.Cost', { id: costId }, { standardPrice: args.costPrice })
        else
          await tx.db.insert('product.Cost', {
            id: costId,
            productId: costProductId,
            standardPrice: args.costPrice,
          })
      }
      if (inventory || Object.keys(shelfLife).length)
        await tx.db.update(
          'product.Template',
          { id: args.id },
          { ...(inventory ? { isStorable, tracking } : {}), ...shelfLife },
        )
      if (changedAccounts.length) {
        const mapped = (await accountSave.handler(tx, {
          templateId: args.id,
          ...Object.fromEntries(accountFields.map((field) => [field, args[field]])),
        })) as Row
        if (!mapped.ok) throw new Refused(mapped)
      }
      return { ok: true, id: args.id }
    }
    return await (options.inTransaction ? write(ctx) : ctx.tx(write))
  } catch (error) {
    if (error instanceof Refused || error instanceof PackagingGridRefused) return error.result
    const refused = tagFailure(error) ?? comboFailure(error) ?? barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}
