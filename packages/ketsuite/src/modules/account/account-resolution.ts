import type { Ctx, Row } from '@ketvietlab/ketjs'

/** Reads a company's fallback accounts, whether or not a row has been written yet. */
export async function defaultsOf(ctx: Ctx): Promise<Row> {
  return (await ctx.db.select('account.Defaults'))[0] ?? {}
}

/**
 * The category a variant belongs to, through its template.
 *
 * An invoice line names a variant, the catalogue hangs the category off the
 * template, and the accounts hang off the category — so reaching one from the
 * other is two hops, not a join this query layer offers.
 */
export async function categoryOfProduct(ctx: Ctx, productId: unknown): Promise<unknown> {
  if (!productId) return null
  const variant = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!variant) return null
  const template = (await ctx.db.select('product.Template', { id: variant.templateId }))[0]
  return template?.categoryId ?? null
}

export const ACCOUNT_RESOLUTION_EFFECTS = [
  'read:account.Account',
  'read:account.Defaults',
  'read:account.CategoryAccount',
  'read:account.ProductAccount',
  'read:product.Category',
  'read:product.Product',
  'read:product.Template',
  'read:partner.CompanyTerms',
] as const

/** Where an invoice line and its counterpart post, and what decided each. */
export type ResolvedAccounts = {
  lineAccountId: unknown
  lineAccountFrom: 'explicit' | 'product' | 'category' | 'company' | null
  counterpartAccountId: unknown
  counterpartAccountFrom: 'explicit' | 'partner' | 'company' | null
}

/**
 * Decide which accounts a document posts to.
 *
 * Most: an explicit choice wins, then the narrowest configured default, then the
 * company's. Asking the person writing an invoice to name a revenue account out
 * of a full chart is asking them to re-answer a question the chart already answers the
 * same way every time — and to get it wrong occasionally.
 *
 * The partner's control accounts are read from `partner.CompanyTerms`, whose
 * account fields the optional `account_partner` module adds. When it is not
 * installed the fields are simply absent and resolution falls through to the
 * company default, which is why this reads them rather than depending on it.
 */
export async function resolveAccounts(
  ctx: Ctx,
  args: {
    moveType: string
    partnerId?: unknown
    productId?: unknown
    templateId?: unknown
    type?: unknown
    categoryId?: unknown
  },
  explicit: { lineAccountId?: unknown; counterpartAccountId?: unknown } = {},
): Promise<ResolvedAccounts> {
  const customer = ['out_invoice', 'out_refund', 'out_receipt'].includes(args.moveType)
  const defaults = await defaultsOf(ctx)

  let lineAccountId = explicit.lineAccountId ?? null
  let lineAccountFrom: ResolvedAccounts['lineAccountFrom'] = lineAccountId ? 'explicit' : null
  if (!lineAccountId) {
    const variant = args.productId
      ? (await ctx.db.select('product.Product', { id: args.productId }))[0]
      : null
    const templateId = variant?.templateId ?? args.templateId
    const template = templateId ? (await ctx.db.select('product.Template', { id: templateId }))[0] : null
    const product = template
      ? (await ctx.db.select('account.ProductAccount', { templateId: template.id }))[0]
      : null
    lineAccountId = (customer ? product?.incomeAccountId : product?.expenseAccountId) ?? null
    if (lineAccountId) lineAccountFrom = 'product'
    let categoryId = template?.categoryId ?? (!templateId ? args.categoryId : null)
    const visited = new Set<string>()
    while (!lineAccountId && categoryId) {
      const id = String(categoryId)
      if (visited.has(id)) throw new Error('account.error.categoryCycle')
      visited.add(id)
      const category = (await ctx.db.select('product.Category', { id }))[0]
      if (!category) break
      const mapped = (await ctx.db.select('account.CategoryAccount', { categoryId: id }))[0]
      lineAccountId = (customer ? mapped?.incomeAccountId : mapped?.expenseAccountId) ?? null
      if (lineAccountId) lineAccountFrom = 'category'
      categoryId = category.parentId
    }
    if (!lineAccountId) {
      const type = template?.type ?? (!templateId ? args.type : null)
      const purchase =
        type === 'service'
          ? defaults.servicePurchaseAccountId
          : type === 'goods'
            ? defaults.goodsPurchaseAccountId
            : null
      lineAccountId = (customer ? defaults.incomeAccountId : (purchase ?? defaults.expenseAccountId)) ?? null
      lineAccountFrom = lineAccountId ? 'company' : null
    }
  }

  let counterpartAccountId = explicit.counterpartAccountId ?? null
  let counterpartAccountFrom: ResolvedAccounts['counterpartAccountFrom'] = counterpartAccountId
    ? 'explicit'
    : null
  if (!counterpartAccountId) {
    const terms = args.partnerId
      ? ((await ctx.db.select('partner.CompanyTerms', { partnerId: args.partnerId }))[0] ?? null)
      : null
    const fromPartner = customer ? terms?.receivableAccountId : terms?.payableAccountId
    if (fromPartner) {
      counterpartAccountId = fromPartner
      counterpartAccountFrom = 'partner'
    } else {
      counterpartAccountId = (customer ? defaults.receivableAccountId : defaults.payableAccountId) ?? null
      counterpartAccountFrom = counterpartAccountId ? 'company' : null
    }
  }

  return { lineAccountId, lineAccountFrom, counterpartAccountId, counterpartAccountFrom }
}
