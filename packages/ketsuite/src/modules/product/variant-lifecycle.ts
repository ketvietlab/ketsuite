import { KetError, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { hasPhysicalStock, stockPositionEffects } from './stock-policy.ts'
import { productCodeOf, ProductCodeRefused } from './codes.ts'
import { releaseBarcodeClaims } from './barcodes.ts'
import { VariantPolicyRefused } from './variant-policy.ts'

export const variantRetirementEffects = [
  'read:product.Cost',
  'write:product.Cost',
  'read:product.ProductUom',
  'write:product.ProductUom',
  ...stockPositionEffects,
  'read:stock.Move',
  'read:sale.OrderLine',
  'read:sale.Order',
  'read:purchase.OrderLine',
  'read:purchase.Order',
  'read:account.MoveLine',
  'read:account.Move',
  'read:pos.OrderLine',
  'read:pos.Order',
]

/** Delete only an unused identity; preserve a reference owned by any installed extension. */
export async function deleteUnusedVariant(ctx: Ctx, productId: string): Promise<boolean> {
  const owned = new Set(['product.Cost', 'product.ProductUom', 'product.ProductValue'])
  const declared = new Set(ctx.manifest.functions[ctx.fnKey]?.effects ?? [])
  for (const [key, model] of Object.entries(ctx.manifest.models)) {
    if (owned.has(key)) continue
    const fields = Object.entries(model.fields).filter(([, field]) => field.target === 'product.Product')
    if (!fields.length) continue
    if (model.scope === 'company+branch' && ctx.scope.branches !== null) return false
    // An extension not included by the deployment factory is unknown, never evidence of no usage.
    if (!declared.has(`read:${key}`)) return false
    for (const [field] of fields) if ((await ctx.db.select(key, { [field]: productId })).length) return false
  }
  const packagings = await ctx.db.select('product.ProductUom', { productId })
  await releaseBarcodeClaims(ctx, [
    { kind: 'variant', id: productId },
    ...packagings.map((row) => ({ kind: 'packaging' as const, id: String(row.id) })),
  ])
  for (const key of owned) {
    const model = ctx.table(key)
    await ctx.db.del(deleteFrom(model).where(eq(model.productId, productId)))
  }
  const product = ctx.table('product.Product')
  await ctx.db.del(deleteFrom(product).where(eq(product.id, productId)))
  return true
}

/** Acquire the shared stock/configuration lock without changing a refused draft's revision. */
export async function lockVariantTemplate(ctx: Ctx, templateId: string): Promise<Row | undefined> {
  const template = (await ctx.db.select('product.Template', { id: templateId }))[0]
  if (!template) return undefined
  const result = await ctx.db.compareAndSet(
    'product.Template',
    { id: templateId },
    {
      revisionId: template.revisionId ?? null,
      ...(ctx.manifest.modules.stock ? { inventoryRevision: template.inventoryRevision ?? null } : {}),
    },
    { revisionId: template.revisionId ?? null },
  )
  if (!('dryRun' in result) && !result.matched)
    throw new KetError({
      code: 'conflict',
      message: 'The product changed; reload before editing its variants.',
    })
  return template
}

/** A completed order's historical line remains valid after its SKU stops selling. */
async function hasOpenVariantDocuments(ctx: Ctx, productId: string): Promise<boolean> {
  if (ctx.manifest.models['stock.Move']) {
    const moves = await ctx.db.select('stock.Move', { productId })
    if (moves.some((move) => !['done', 'cancel'].includes(String(move.state)))) return true
  }
  for (const module of ['sale', 'purchase', 'pos']) {
    if (!ctx.manifest.models[`${module}.OrderLine`]) continue
    for (const line of await ctx.db.select(`${module}.OrderLine`, { productId })) {
      const order = (await ctx.db.select(`${module}.Order`, { id: line.orderId }))[0]
      if (!order || ['cancel', 'done', 'invoiced'].includes(String(order.state))) continue
      if (module === 'pos') return true
      const confirmed = module === 'sale' ? 'sale' : 'purchase'
      if (order.state !== confirmed) return true
      const quantity = Number(module === 'sale' ? line.productUomQty : line.productQty)
      const fulfilled = Number(module === 'sale' ? line.qtyDelivered : line.qtyReceived)
      if (fulfilled < quantity || Number(line.qtyInvoiced) < quantity) return true
    }
  }
  if (ctx.manifest.models['account.MoveLine'])
    for (const line of await ctx.db.select('account.MoveLine', { productId })) {
      const move = (await ctx.db.select('account.Move', { id: line.moveId }))[0]
      if (move?.state === 'draft') return true
    }
  return false
}

/** Caller holds the template lock, also used by stock position writers. */
export async function assertVariantCanRetire(ctx: Ctx, template: Row, variant: Row) {
  const names = new Map(
    (await ctx.db.select('product.AttributeValue')).map((value) => [String(value.id), String(value.name)]),
  )
  const values = String(variant.combinationKey ?? '')
    .split(',')
    .map((id) => names.get(id))
    .filter(Boolean)
  const label = [String(template.name), ...values, productCodeOf(variant.defaultCode)]
    .filter(Boolean)
    .join(' · ')
  // Thrown so the caller's transaction rolls back, and returned as a translated issue.
  const refuse = (code: string) =>
    new VariantPolicyRefused({
      ok: false,
      errors: [{ field: 'variants', code: `product.error.variant.${code}`, params: { variant: label } }],
    })
  if (await hasPhysicalStock(ctx, [String(variant.id)])) throw refuse('stocked')
  if (await hasOpenVariantDocuments(ctx, String(variant.id))) throw refuse('openDocuments')
}

const letters = (index: number): string => {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

/** Existing and archived codes both reserve their names in the company's namespace. */
export function nextVariantCode(base: string | null, taken: Set<string>): string | null {
  if (!base) return null // Low-level legacy catalogues may not have assigned a base code yet.
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = base + letters(index)
    if (!/^[A-Z0-9-]{2,20}$/.test(candidate)) throw new ProductCodeRefused('defaultCode', 'codeFormat')
    if (taken.has(candidate.toUpperCase())) continue
    taken.add(candidate.toUpperCase())
    return candidate
  }
  throw new ProductCodeRefused('defaultCode', 'codeTaken')
}
