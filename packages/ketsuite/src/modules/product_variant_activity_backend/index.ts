import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { targetActivityFunctions } from '../activity/index.ts'

const functions = targetActivityFunctions({
  resModel: 'product.Product',
  targetEffect: 'read:product.Product',
  verify: async (ctx: Ctx, targetId: string) => {
    const P = ctx.table('product.Product')
    const row = await ctx.db.one(from(P).where(eq(P.id, targetId)))
    if (!row)
      throw new KetError({
        code: 'E_PRODUCT_VARIANT_ACTIVITY_TARGET',
        module: 'product_variant_activity_backend',
        message: 'product variant is missing or unavailable in this tenant',
      })
    return { id: String(row.id), displayName: String(row.defaultCode || row.id) }
  },
})

export default defineModule({
  name: 'product_variant_activity_backend',
  version: '0.1.0',
  depends: ['product_backend', 'product_variant_mail_backend', 'activity_backend'],
  functions,
  fills: {
    // The panel opens on the activity types and this variant's activities; whoever may not
    // read both is not shown it.
    'product_backend:variant.collaboration': `{% if may.activity.listTypes %}{% if may.product_variant_activity_backend.list %}{% island "activity.record" %}{% endif %}{% endif %}`,
  },
})

export { functions }
