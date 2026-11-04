import { comboRefusal } from '../combo-policy.ts'
import {
  BARCODE_EFFECTS,
  barcodeFailure,
  barcodeKey,
  claimBarcode,
  releaseBarcodeClaims,
} from '../barcodes.ts'
import { claimProductCodeRevision } from '../codes.ts'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { productExists, companyKey } from './shared.ts'

const uomRoot = (row: Row): string => String(row.parentPath).split('/').filter(Boolean)[0] ?? ''

type FieldErrors = {
  ok: false
  errors: Array<{ field: string; message: string } | { field: string; code: string }>
}

type UomTarget = { ok: true; company: string; id: string; existing: Row | undefined }

/**
 * What both unit writers have to agree on before touching `product.ProductUom`.
 *
 * The existing row is matched on (productId, uomId) within the active company
 * rather than on a derived id: a read spans every readable company, so an id-only
 * lookup can return a sibling company's row — which the write then filters out,
 * changing nothing. Matching this way also still finds rows written under the
 * older tenant-global id scheme.
 */
const productUomTarget = async (
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<FieldErrors | UomTarget> => {
  if (!(await productExists(ctx, args.productId)))
    return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
  const company = ctx.scope.company
  if (!company)
    return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi đơn vị' }] }
  const unit = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
  if (!unit) return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị không tồn tại' }] }
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]!
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
  if (template.type === 'combo') return comboRefusal('productId', 'noPackaging')
  const primary = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : null
  if (!primary || uomRoot(primary) !== uomRoot(unit))
    return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị phải cùng cây với UoM mặc định' }] }
  const existing = (
    await ctx.db.select('product.ProductUom', { productId: args.productId, uomId: args.uomId })
  ).find((row) => String(row.companyId) === company)
  return {
    ok: true,
    company,
    id: existing ? String(existing.id) : companyKey(company, args.productId, args.uomId),
    existing,
  }
}

const writeProductUom = async (ctx: Ctx, target: UomTarget, args: Record<string, unknown>): Promise<void> => {
  const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]!
  const template = (await ctx.db.select('product.Template', { id: product.templateId }))[0]!
  await claimProductCodeRevision(ctx, template)
  const held = (await ctx.db.select('product.ProductUom', { id: target.id }))[0]
  const patch = await claimBarcode(ctx, { kind: 'packaging', id: target.id }, held, args.barcode)

  if (held) await ctx.db.update('product.ProductUom', { id: target.id }, patch)
  else
    await ctx.db.insert('product.ProductUom', {
      id: target.id,
      productId: args.productId,
      uomId: args.uomId,
      ...patch,
    })
  await ctx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
}

/** Drop every unit this company holds for the variant, except the one being kept. */
const dropProductUoms = async (
  ctx: Ctx,
  company: string,
  productId: unknown,
  keep: string | null,
): Promise<void> => {
  const U = ctx.table('product.ProductUom')
  for (const row of await ctx.db.select('product.ProductUom', { productId }))
    if (String(row.companyId) === company && String(row.id) !== keep) {
      await releaseBarcodeClaims(ctx, [{ kind: 'packaging', id: String(row.id) }])
      await ctx.db.del(deleteFrom(U).where(eq(U.id, row.id)))
    }
}

export async function addTemplateUomHandler(ctx: Ctx, args: Record<string, unknown>) {
  return ctx.tx(async (ctx) => {
    const template = (await ctx.db.select('product.Template', { id: args.templateId }))[0]
    if (!template) return { ok: false, errors: [{ field: 'templateId', message: 'template không tồn tại' }] }
    if (template.type === 'combo') return comboRefusal('templateId', 'noPackaging')
    const primary = template.uomId ? (await ctx.db.select('uom.Unit', { id: template.uomId }))[0] : null
    const unit = (await ctx.db.select('uom.Unit', { id: args.uomId }))[0]
    if (!primary || !unit || uomRoot(primary) !== uomRoot(unit))
      return { ok: false, errors: [{ field: 'uomId', message: 'đơn vị phải cùng cây với UoM mặc định' }] }
    const existing = (
      await ctx.db.select('product.TemplateUom', { templateId: args.templateId, uomId: args.uomId })
    )[0]
    if (existing) return { ok: true, id: existing.id }
    await claimProductCodeRevision(ctx, template)
    await ctx.db.insertIfAbsent('product.TemplateUom', {
      id: `${String(args.templateId)}:${String(args.uomId)}`,
      templateId: args.templateId,
      uomId: args.uomId,
    })
    // The held row answers: a company copy of the catalogue gives it an opaque id.
    const held = (
      await ctx.db.select('product.TemplateUom', { templateId: args.templateId, uomId: args.uomId })
    )[0]!
    await ctx.db.update('uom.Unit', { id: args.uomId }, { locked: true })
    return { ok: true, id: held.id }
  })
}

export async function addProductUomHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    const target = await productUomTarget(ctx, args)
    if (!target.ok) return target
    await ctx.tx(async (tx) => {
      await writeProductUom(tx, target, args)
    })
    return { ok: true, id: target.id }
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}

export async function setProductUomHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    if (!(await productExists(ctx, args.productId)))
      return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
    const company = ctx.scope.company
    if (!company)
      return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi đơn vị' }] }
    if (args.uomId == null) {
      await ctx.tx(async (tx) => {
        const product = (await tx.db.select('product.Product', { id: args.productId }))[0]!
        const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
        await claimProductCodeRevision(tx, template)
        await dropProductUoms(tx, company, args.productId, null)
      })
      return { ok: true }
    }
    const target = await productUomTarget(ctx, args)
    if (!target.ok) return target
    await ctx.tx(async (tx) => {
      await dropProductUoms(tx, company, args.productId, target.id)
      await writeProductUom(tx, target, args)
    })
    return { ok: true, id: target.id }
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}

export async function removeTemplateUomHandler(ctx: Ctx, args: Record<string, unknown>) {
  try {
    const link = (
      await ctx.db.select('product.TemplateUom', { templateId: args.templateId, uomId: args.uomId })
    )[0]
    if (!link)
      return {
        ok: false,
        errors: [
          {
            field: 'uomId',
            code: 'product.error.packaging.notLinked',
            message: 'đơn vị chưa gắn vào sản phẩm',
          },
        ],
      }
    const company = ctx.scope.company
    const products = new Set(
      (await ctx.db.select('product.Product', { templateId: args.templateId })).map((row) => String(row.id)),
    )
    await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: args.templateId }))[0]!
      await claimProductCodeRevision(tx, template)
      const T = tx.table('product.TemplateUom')
      await tx.db.del(deleteFrom(T).where(eq(T.id, link.id)))
      const U = tx.table('product.ProductUom')
      for (const row of await tx.db.select('product.ProductUom', { uomId: args.uomId }))
        if (company && String(row.companyId) === company && products.has(String(row.productId))) {
          await releaseBarcodeClaims(tx, [{ kind: 'packaging', id: String(row.id) }])
          await tx.db.del(deleteFrom(U).where(eq(U.id, row.id)))
        }
    })
    return { ok: true }
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}

/** A barcode refused while writing one packaging row names that row, as the form posted it. */
const packagingBarcodeRefusal = (refused: Row, index: number | undefined): Row => {
  if (index === undefined) return refused
  const errors = (refused.errors as Array<{ field: string; code: string }>).map((issue) => ({
    ...issue,
    field: `barcodes.${index}.barcode`,
    code:
      issue.code === 'product.error.template.barcodeTaken'
        ? 'product.error.packaging.barcodeTaken'
        : issue.code,
  }))
  return { ...refused, errors }
}

export async function setPackagingBarcodesHandler(ctx: Ctx, args: Record<string, unknown>) {
  const indexOf = new Map<string, number>()
  let writing: string | null = null
  try {
    const product = (await ctx.db.select('product.Product', { id: args.productId }))[0]
    if (!product) return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
    const company = ctx.scope.company
    if (!company)
      return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi đơn vị' }] }
    const linked = new Set(
      (await ctx.db.select('product.TemplateUom', { templateId: product.templateId })).map((row) =>
        String(row.uomId),
      ),
    )
    const held = (await ctx.db.select('product.ProductUom', { productId: args.productId })).filter(
      (row) => String(row.companyId) === company,
    )
    const entries = Array.isArray(args.barcodes) ? (args.barcodes as Array<Record<string, unknown>>) : []
    const wanted = new Map<string, string | null>()
    const errors: Array<{ field: string; code: string; message: string }> = []
    for (const [index, entry] of entries.entries()) {
      const uomId = String(entry?.uomId ?? '')
      const barcode = typeof entry?.barcode === 'string' && entry.barcode.trim() ? entry.barcode.trim() : null
      indexOf.set(uomId, index)
      if (!linked.has(uomId))
        errors.push({
          field: `barcodes.${index}.uomId`,
          code: 'product.error.packaging.notLinked',
          message: 'đơn vị chưa gắn vào sản phẩm',
        })
      else if (barcode && [...wanted.values()].some((value) => barcodeKey(value) === barcodeKey(barcode)))
        errors.push({
          field: `barcodes.${index}.barcode`,
          code: 'product.error.packaging.barcodeRepeated',
          message: 'hai đơn vị đóng gói trùng barcode',
        })
      else wanted.set(uomId, barcode)
    }
    if (errors.length) return { ok: false, errors }
    await ctx.tx(async (tx) => {
      const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
      await claimProductCodeRevision(tx, template)
      const U = tx.table('product.ProductUom')
      const changing = held.filter(
        (row) => wanted.has(String(row.uomId)) && wanted.get(String(row.uomId)) !== row.barcode,
      )
      await releaseBarcodeClaims(
        tx,
        changing.map((row) => ({ kind: 'packaging' as const, id: String(row.id) })),
      )
      for (const row of changing) await tx.db.update('product.ProductUom', { id: row.id }, { barcode: null })
      for (const [uomId, barcode] of wanted) {
        writing = uomId
        const existing = held.find((row) => String(row.uomId) === uomId)
        if (!barcode) {
          if (existing) await tx.db.del(deleteFrom(U).where(eq(U.id, existing.id)))
          continue
        }
        await writeProductUom(
          tx,
          {
            ok: true,
            company,
            id: existing ? String(existing.id) : companyKey(company, args.productId, uomId),
            existing,
          },
          { productId: args.productId, uomId, barcode },
        )
      }
    })
    return { ok: true }
  } catch (error) {
    const refused = barcodeFailure(error)
    if (refused) return packagingBarcodeRefusal(refused, writing === null ? undefined : indexOf.get(writing))
    throw error
  }
}

export const packagingFunctions: Record<string, FnSpec> = {
  addTemplateUom: defineFn({
    input: { templateId: 'id', uomId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'write:product.Template',
      'read:product.TemplateUom',
      'read:uom.Unit',
      'write:uom.Unit',
      'write:product.TemplateUom',
    ],
    idempotent: true,
    agent: true,
    handler: addTemplateUomHandler,
  }),
  addProductUom: defineFn({
    input: { productId: 'id', uomId: 'id', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
      'write:uom.Unit',
      'write:product.ProductUom',
      'write:product.Template',
      ...BARCODE_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: addProductUomHandler,
  }),
  /**
   * The variant's unit, as one value rather than a growing list.
   *
   * `addProductUom` is an add and stays one, but the variant form offers a single
   * select: submitting it has to *replace* what is there, or changing the unit
   * silently leaves the old row behind and the form — which renders the first row
   * it is given — keeps showing the unit the user just changed away from. A null
   * `uomId` clears the unit, which is what the form's empty option means.
   */
  setProductUom: defineFn({
    input: { productId: 'id', uomId: 'id?', barcode: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
      'write:uom.Unit',
      'write:product.ProductUom',
      'write:product.Template',
      ...BARCODE_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: setProductUomHandler,
  }),
  /**
   * Take a packaging off a product: sales and purchases no longer offer the unit for
   * it, and the barcodes its variants carried in that unit in this company go too.
   * The unit itself stays, with its conversion, for the other products using it.
   */
  removeTemplateUom: defineFn({
    input: { templateId: 'id', uomId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.TemplateUom',
      'write:product.TemplateUom',
      'read:product.Product',
      'read:product.ProductUom',
      'write:product.ProductUom',
      'write:product.Template',
      ...BARCODE_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: removeTemplateUomHandler,
  }),
  /**
   * A variant's barcode in each of its product's packagings, as one form shows them.
   * An empty barcode drops that row; the packaging stays on the product. A barcode may
   * not repeat a variant's barcode or one this company gives another packaging, since a
   * scan has to name one product in one unit.
   */
  setPackagingBarcodes: defineFn({
    input: { productId: 'id', barcodes: 'json' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:product.Product',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'write:product.ProductUom',
      'write:product.Template',
      ...BARCODE_EFFECTS,
      'read:uom.Unit',
      'write:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: setPackagingBarcodesHandler,
  }),
}
