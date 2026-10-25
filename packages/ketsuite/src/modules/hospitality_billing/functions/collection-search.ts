import { normalizeHospitalityCollectionQuery } from '../../hospitality_core/functions/collection-search.ts'
import { defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import type { HospitalityCollectionDefinition } from '../../hospitality_core/functions/collection-search.ts'
import { foldText } from '../../hospitality_core/stay-book-query.ts'
import { CHARGE_TYPES } from '../../hospitality_core/types.ts'
import { messages } from '../messages.ts'
import { chargeRuleConfigured } from './accounting.ts'

/**
 * The billing rules list (HOS-DEC-034): every charge type the product invoices is a row, whether or not a rule was
 * ever saved for it. A type is `ready` once its rule answers the tax question (an approved tax, or no tax with a
 * reason) and `incomplete` until then; the income account is optional and does not decide it. The catalogue is
 * fixed and short, so the whole of it is read, searched and counted at once: what needs setting up first, then
 * the catalogue's own order.
 */
export const chargeRuleCollection: HospitalityCollectionDefinition = {
  name: 'searchChargeRules',
  model: 'hospitality_billing.ChargeRule',
  search: [],
  sort: ['attention'],
  defaultSort: 'attention',
  state: 'state',
  states: ['all', 'incomplete', 'ready'],
  reads: ['account.Account', 'account.Tax'],
}

// A charge type is found by its name in either language the product speaks, accents optional.
const typeNames = (type: string) =>
  ['vi', 'en'].map((lang) => String(messages[lang]?.[`chargeType.${type}`] ?? '')).join(' ')

async function searchChargeRules(ctx: Ctx, input: Record<string, unknown>) {
  const query = normalizeHospitalityCollectionQuery(input, chargeRuleCollection)
  const R = ctx.table('hospitality_billing.ChargeRule')
  const saved = await ctx.db.all(
    from(R)
      .where(eq(R.companyId!, ctx.scope.company), inArray(R.chargeType!, [...CHARGE_TYPES]))
      .limit(CHARGE_TYPES.length * 2),
  )
  const rules = new Map(saved.map((row) => [String(row.chargeType), row]))
  const named = async (model: string, ids: unknown[]) => {
    const wanted = [...new Set(ids.filter(Boolean))]
    if (!wanted.length) return new Map<unknown, Row>()
    const T = ctx.table(model)
    const rows = await ctx.db.all(
      from(T).where(eq(T.companyId!, ctx.scope.company), inArray(T.id, wanted)).limit(wanted.length),
    )
    return new Map(rows.map((row) => [row.id, row]))
  }
  const [accounts, taxes] = await Promise.all([
    named(
      'account.Account',
      saved.map((row) => row.incomeAccountId),
    ),
    named(
      'account.Tax',
      saved.map((row) => row.taxId),
    ),
  ])
  const rows = CHARGE_TYPES.map((chargeType) => {
    const rule = rules.get(chargeType)
    const account = rule ? accounts.get(rule.incomeAccountId) : undefined
    const tax = rule && rule.taxExempt !== true ? taxes.get(rule.taxId) : undefined
    const incomeAccount = account ? `${account.code} · ${account.name}` : null
    return {
      id: chargeType,
      chargeType,
      state: rule && chargeRuleConfigured(rule) ? 'ready' : 'incomplete',
      // Left empty, the invoice takes the product's or the journal's account.
      incomeAccount,
      tax: tax ? String(tax.name) : null,
      taxExempt: rule?.taxExempt === true,
      version: rule?.version ?? 0,
      folded: foldText(`${chargeType} ${typeNames(chargeType)} ${incomeAccount ?? ''} ${tax?.name ?? ''}`),
    }
  })
  const needle = foldText(query.q)
  const found = needle ? rows.filter((row) => row.folded.includes(needle)) : rows
  const counts = {
    all: found.length,
    incomplete: found.filter((row) => row.state === 'incomplete').length,
    ready: found.filter((row) => row.state === 'ready').length,
  }
  // Stable: each state keeps the catalogue's order.
  const ordered = found
    .filter((row) => query.state === 'all' || row.state === query.state)
    .sort((a, b) => Number(a.state === 'ready') - Number(b.state === 'ready'))
  const total = ordered.length
  const pages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(pages, query.page)
  return {
    query: { ...query, page },
    total,
    page,
    pages,
    rows: ordered
      .slice((page - 1) * query.pageSize, page * query.pageSize)
      .map(({ folded: _folded, ...row }) => row),
    counts: { state: counts },
    isEmpty: false,
  }
}

export const billingCollectionFunctions: Record<string, FnSpec> = {
  searchChargeRules: defineFn({
    // The shared list store sends every collection's query; the filters this list has no use for are ignored.
    input: {
      q: 'text?',
      state: 'text?',
      sort: 'text?',
      direction: 'text?',
      propertyId: 'id?',
      roomTypeId: 'id?',
      floorId: 'id?',
      from: 'datetime?',
      to: 'datetime?',
      page: 'int?',
      pageSize: 'int?',
    },
    output: {
      query: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      rows: 'json',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: ['read:hospitality_billing.ChargeRule', 'read:account.Account', 'read:account.Tax'],
    handler: searchChargeRules,
  }),
}
