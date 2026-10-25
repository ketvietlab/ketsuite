import { and, asc, defineFn, eq, from, gt, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { contentImageFunctions } from './functions/content-images.ts'
import { propertyAccess } from './functions/command.ts'
export { appendContentChange } from './content-change.ts'

export const content: Record<string, FnSpec> = {
  ...contentImageFunctions,
  listContentChanges: defineFn({
    input: { propertyId: 'id', afterAt: 'datetime?', afterId: 'id?', limit: 'int?' },
    output: {
      id: 'id',
      propertyId: 'id',
      resourceType: 'text',
      resourceId: 'text',
      kind: 'text',
      createdAt: 'datetime',
    },
    effects: ['read:hospitality_core.ContentChange', 'read:hospitality_core.Property'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      await propertyAccess(ctx, args.propertyId)
      const Change = ctx.table('hospitality_core.ContentChange')
      let query = from(Change)
        .where(eq(Change.propertyId, args.propertyId))
        .orderBy(asc(Change.createdAt), asc(Change.id))
      if (args.afterAt && args.afterId)
        query = query.where(
          or(
            gt(Change.createdAt, args.afterAt),
            and(eq(Change.createdAt, args.afterAt), gt(Change.id, args.afterId)),
          ),
        )
      else if (args.afterAt) query = query.where(gt(Change.createdAt, args.afterAt))
      return ctx.db.all(query.limit(Math.max(1, Math.min(500, Number(args.limit ?? 100)))))
    },
  }),
}
