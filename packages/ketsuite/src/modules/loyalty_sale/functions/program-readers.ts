import { defineFn, type Ctx, type Row } from '@ketvietlab/ketjs'
import { civilDateAt, DEFAULT_ACCOUNTING_TIMEZONE } from '../../account/date.ts'
import { ours } from '../../sale/scope.ts'

const own = (ctx: Ctx, row: Row) => !row.companyId || row.companyId === ctx.scope.company
const referenceModels: Record<string, string> = {
  product: 'product.Product',
  category: 'product.Category',
  tag: 'product.Tag',
  pricelist: 'pricing.Pricelist',
  partner: 'partner.Partner',
}
export async function searchProgramReferences(ctx: Ctx, args: Row) {
  const model = referenceModels[String(args.kind)]
  if (!model) return []
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String).slice(0, 100)) : null
  const search = String(args.search ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('vi')
  const rows = (await ctx.db.select(model)).filter(
    (row) => own(ctx, row) && (ids ? ids.has(String(row.id)) : row.active !== false),
  )
  const templates =
    model === 'product.Product'
      ? new Map(
          (await ctx.db.select('product.Template'))
            .filter((row) => own(ctx, row))
            .map((row) => [String(row.id), row]),
        )
      : null
  return rows
    .flatMap((row) => {
      const template = templates?.get(String(row.templateId))
      if (
        templates &&
        (!template ||
          (!ids && (template.active === false || template.saleOk === false)) ||
          (args.gift === true && template.type === 'combo'))
      )
        return []
      const name = String(row.displayName || row.name || template?.name || row.id)
      const label = row.defaultCode ? String(row.defaultCode) + ' - ' + name : name
      if (search && !label.toLocaleLowerCase('vi').includes(search)) return []
      return [{ id: String(row.id), name: label, active: row.active !== false }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, ids ? 100 : 25)
}
export async function listProgramCards(ctx: Ctx, args: Row) {
  const program = (await ours(ctx, 'loyalty.Program', { id: args.id }))[0]
  if (program?.salePolicyVersion !== 1) return null
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const day = civilDateAt(
    new Date().toISOString(),
    company?.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE,
  )
  const partners = new Map(
    (await ctx.db.select('partner.Partner'))
      .filter((row) => own(ctx, row))
      .map((row) => [String(row.id), String(row.name)]),
  )
  const ledger = await ours(ctx, 'loyalty.LedgerEntry')
  const entries = new Map(ledger.map((row) => [String(row.id), row]))
  const cancelledIssuance = new Set(
    ledger
      .filter(
        (row) =>
          row.operation === 'reverse' && entries.get(String(row.reversedEntryId))?.operation === 'earn',
      )
      .map((row) => String(row.walletId)),
  )
  const all = (await ours(ctx, 'loyalty.Wallet', { programId: program.id }))
    .map((row) => ({
      id: row.id,
      code: row.code,
      partnerName: row.partnerId ? (partners.get(String(row.partnerId)) ?? '') : '',
      balance: row.balance,
      reserved: row.reserved,
      expiresOn:
        row.saleExpiresOn ??
        (row.expiresAt
          ? civilDateAt(row.expiresAt, company?.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE)
          : null),
      state: !row.active
        ? Number(row.balance) > 0 || (Number(row.balance) === 0 && cancelledIssuance.has(String(row.id)))
          ? 'cancelled'
          : 'used'
        : (row.saleExpiresOn && String(row.saleExpiresOn) < day) ||
            (row.expiresAt && String(row.expiresAt) < new Date().toISOString())
          ? 'expired'
          : 'active',
      createdAt: row.createdAt,
    }))
    .sort(
      (a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)) || String(a.id).localeCompare(String(b.id)),
    )
  const search = String(args.search ?? '')
    .trim()
    .toLocaleLowerCase('vi')
  const rows = all.filter(
    (row) =>
      (!args.state || row.state === args.state) &&
      (!search ||
        [row.code, row.partnerName].some((value) => String(value).toLocaleLowerCase('vi').includes(search))),
  )
  const pageSize = Math.max(1, Math.min(100, Number(args.pageSize ?? 25))),
    pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
  return {
    program: { id: program.id, name: program.name, programType: program.programType },
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pages,
    isEmpty: all.length === 0,
    counts: Object.fromEntries(
      ['active', 'used', 'cancelled', 'expired'].map((state) => [
        state,
        all.filter((row) => row.state === state).length,
      ]),
    ),
  }
}
export const programReaderFunctions = {
  searchProgramReferences: defineFn({
    input: { kind: 'text', search: 'text?', ids: 'json?', gift: 'bool?', limit: 'int?' },
    effects: [
      'read:product.Product',
      'read:product.Template',
      'read:product.Category',
      'read:product.Tag',
      'read:pricing.Pricelist',
      'read:partner.Partner',
    ],
    handler: searchProgramReferences,
  }),
  listProgramCards: defineFn({
    input: { id: 'id', search: 'text?', state: 'text?', page: 'int?', pageSize: 'int?' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.LedgerEntry',
      'read:loyalty.Wallet',
      'read:partner.Partner',
      'read:company.Company',
    ],
    handler: listProgramCards,
  }),
}
