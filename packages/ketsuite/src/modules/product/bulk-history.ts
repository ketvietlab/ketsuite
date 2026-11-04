import { and, eq, from, desc, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
export async function readBulkEdits(ctx: Ctx, args: Row) {
  const B = ctx.table('product.BulkEdit'),
    I = ctx.table('product.BulkEditItem')
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 20))
  const items = await ctx.db.all(
    from(I)
      .select(I.bulkEditId!)
      .where(and(eq(I.companyId!, ctx.scope.company), eq(I.templateId!, args.templateId))),
  )
  const rows = items.length
    ? await ctx.db.all(
        from(B)
          .where(
            and(
              eq(B.companyId!, ctx.scope.company),
              inArray(
                B.id!,
                items.map((item) => item.bulkEditId),
              ),
            ),
          )
          .select(
            B.id!,
            B.name!,
            B.actor!,
            B.occurredAt!,
            B.field!,
            B.value!,
            B.valueLabel!,
            B.productCount!,
            B.changedCount!,
          )
          .orderBy(desc(B.occurredAt!))
          .limit(limit),
      )
    : []
  return { rows }
}
