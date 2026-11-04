import { compareDecimals } from '../account/money.ts'
import { comboRefusal } from './combo-policy.ts'
import { claimStockConfiguration, hasPhysicalStock, stockLocked } from './stock-policy.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { productExists, companyKey } from './functions/shared.ts'

class CostRefused extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('cost edit refused')
    this.result = result
  }
}

export async function saveProductCost(
  ctx: Ctx,
  args: Record<string, unknown>,
  options: { inTransaction?: boolean } = {},
) {
  if (!(await productExists(ctx, args.productId)))
    return { ok: false, errors: [{ field: 'productId', message: 'biến thể không tồn tại' }] }
  if (!ctx.scope.company)
    return { ok: false, errors: [{ field: 'company', message: 'cần chọn company để ghi giá vốn' }] }
  const standardPrice = args.standardPrice ?? args.amount
  if (standardPrice == null) return { ok: false, errors: [{ field: 'standardPrice', message: 'bắt buộc' }] }
  // Look the row up by the id that already names the active company, not by
  // productId: a read spans every readable company, so searching on productId
  // alone can return a sibling company's cost. Updating that row then filters
  // on the active company and changes nothing, while the insert branch is
  // skipped — a write that reports success and stores no price.
  const id = companyKey(ctx.scope.company, args.productId)
  if (!Number.isFinite(Number(standardPrice)) || Number(standardPrice) < 0)
    return { ok: false, errors: [{ field: 'standardPrice', code: 'product.error.template.costPositive' }] }
  try {
    const write = async (tx: Ctx) => {
      const existing = (await tx.db.select('product.Cost', { id }))[0]
      if (existing && compareDecimals(existing.standardPrice, standardPrice) === 0) return { ok: true, id }
      const product = (await tx.db.select('product.Product', { id: args.productId }))[0]!
      const template = (await tx.db.select('product.Template', { id: product.templateId }))[0]!
      if (template.type === 'combo') return comboRefusal('standardPrice', 'noStock')
      await claimStockConfiguration(tx, template)
      if (await hasPhysicalStock(tx, [String(args.productId)]))
        throw new CostRefused(stockLocked(['standardPrice']))
      if (existing) await tx.db.update('product.Cost', { id }, { standardPrice })
      else await tx.db.insert('product.Cost', { id, productId: args.productId, standardPrice })
      return { ok: true, id }
    }
    return await (options.inTransaction ? write(ctx) : ctx.tx(write))
  } catch (error) {
    if (error instanceof CostRefused) return error.result
    throw error
  }
}
