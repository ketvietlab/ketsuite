import { and, desc, eq, from, ilike, inArray, or } from '@ketvietlab/ketjs'
import { importNameKey } from './import-format.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { holdsFunction } from './functions/shared.ts'
import { parseProductImport, exportProductImportCsv, productImportColumns } from './import-format.ts'
const company = (ctx: Ctx) => ({ companyId: ctx.scope.company })
const metadata = [
  'id',
  'name',
  'actor',
  'occurredAt',
  'rowCount',
  'createdCount',
  'changedCount',
  'variantCount',
] as const
export async function readProductImports(ctx: Ctx, args: Row) {
  const T = ctx.table('product.Import')
  const conditions = [eq(T.companyId!, ctx.scope.company)]
  if (args.templateId) {
    const I = ctx.table('product.ImportItem')
    const items = await ctx.db.all(
      from(I)
        .select(I.importId!)
        .where(and(eq(I.companyId!, ctx.scope.company), eq(I.templateId!, args.templateId))),
    )
    if (!items.length) return { rows: [] as Row[], total: 0, page: 1, pages: 1 }
    conditions.push(
      inArray(
        T.id!,
        items.map((item) => item.importId),
      ),
    )
  }
  if (args.q) {
    const needle = importNameKey(String(args.q)),
      I = ctx.table('product.ImportItem')
    const matched = (
      await ctx.db.all(from(I).select(I.importId!, I.code!).where(eq(I.companyId!, ctx.scope.company)))
    ).filter((item) => importNameKey(String(item.code ?? '')).includes(needle))
    const pattern = '%' + needle.replace(/[\\%_]/g, '\\$&') + '%'
    conditions.push(
      or(
        ilike(T.name!, pattern, true),
        inArray(
          T.id!,
          matched.map((item) => item.importId),
        ),
      ),
    )
  }
  const query = from(T).where(and(...conditions))
  const total = await ctx.db.count(query),
    limit = Math.min(100, Math.max(1, Math.floor(Number(args.limit) || 30)))
  const pages = Math.max(1, Math.ceil(total / limit)),
    page = Math.min(pages, Math.max(1, Math.floor(Number(args.page) || 1)))
  const offset = args.page == null ? Math.max(0, Math.floor(Number(args.offset) || 0)) : (page - 1) * limit
  const rows = await ctx.db.all(
    query
      .select(...metadata.map((key) => T[key]!))
      .orderBy(desc(T.occurredAt!), desc(T.name!))
      .offset(offset)
      .limit(limit),
  )
  return { rows, total, page, pages }
}
export async function readProductImport(ctx: Ctx, args: Row) {
  const row = (await ctx.db.select('product.Import', { ...company(ctx), id: args.id }))[0]
  if (!row) return { record: null }
  const cost = await holdsFunction(ctx, 'product.listVariantCosts')
  const items = await ctx.db.select('product.ImportItem', { ...company(ctx), importId: row.id })
  const T = ctx.table('product.Template')
  const templates = items.length
    ? await ctx.db.all(
        from(T)
          .select(T.id!)
          .where(
            inArray(
              T.id!,
              items.map((item) => item.templateId),
            ),
          ),
      )
    : []
  let data = row.data
  if (!cost) {
    const parsed = parseProductImport(data),
      columns = productImportColumns.filter((column) => column.key !== 'cost')
    data = exportProductImportCsv([
      columns.map((column) => column[args.locale === 'en' ? 'en' : 'vi']),
      ...parsed.map((item) => columns.map((column) => item.cells[column.key] ?? '')),
    ])
  }
  return {
    record: { ...row, data, costRedacted: !cost },
    items: items.map((item) => ({
      ...item,
      exists: templates.some((template) => template.id === item.templateId),
    })),
  }
}
