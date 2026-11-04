import { randomUUID } from 'node:crypto'
import { desc, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import { messages } from './messages.ts'
import { categoryFailure, lockCategories, requireActiveCategory } from './category-policy.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { comboFailure, lockCombos } from './combo-policy.ts'
import { TEMPLATE_COMBO_EFFECTS, templateComboIds, validateTemplateCombos } from './template-combos.ts'

/** Quotations and unfinished stock operations still need a selectable product. */
async function hasOpenDocuments(ctx: Ctx, ids: string[]): Promise<boolean> {
  if (!ids.length) return false
  if (ctx.manifest.models['sale.OrderLine']) {
    const L = ctx.table('sale.OrderLine')
    const O = ctx.table('sale.Order')
    const lines = await ctx.db.all(from(L).where(inArray(L.productId, ids)))
    const orders = [...new Set(lines.map((line) => String(line.orderId)))]
    const open = orders.length
      ? await ctx.db.one(
          from(O)
            .where(inArray(O.id, orders))
            .where(inArray(O.state, ['draft', 'sent'])),
        )
      : null
    if (open) return true
  }
  if (ctx.manifest.models['stock.Move']) {
    const M = ctx.table('stock.Move')
    const moves = await ctx.db.all(from(M).where(inArray(M.productId, ids)))
    if (moves.some((move) => !['done', 'cancel'].includes(String(move.state)))) return true
  }
  return false
}

export async function changeTemplateState(ctx: Ctx, args: Row) {
  const ids =
    args.ids == null
      ? [String(args.id ?? '')]
      : Array.isArray(args.ids)
        ? [...new Set(args.ids.map(String))]
        : []
  if (!ids.length || ids.length > 100 || ids.some((id) => !id))
    return { ok: false, errors: [{ field: 'ids', code: 'product.error.archive.selection' }] }
  const reason = String(args.reason ?? '').trim()
  if (!args.active && (!reason || reason.length > 500))
    return { ok: false, errors: [{ field: 'reason', code: 'product.error.archive.reason' }] }
  const revisions =
    args.expectedRevisions &&
    typeof args.expectedRevisions === 'object' &&
    !Array.isArray(args.expectedRevisions)
      ? (args.expectedRevisions as Row)
      : {}
  const error = (key: string, code: string) =>
    new KetError({
      code,
      message: String(messages[args.locale === 'en' ? 'en' : 'vi']?.[`error.archive.${key}`] ?? key),
    })
  const tx = ctx
  const comboIds = (await Promise.all(ids.map((id) => templateComboIds(tx, id)))).flat()
  await lockCombos(tx, [...new Set(comboIds)].sort())
  // Bulk restoration takes category locks before template locks, in deterministic order.
  if (args.active) await lockCategories(tx)
  const entries: Array<{ record: Row; products: Row[] }> = []
  // Validate every selected record before changing any of them.
  for (const id of ids) {
    const record = (await tx.db.select('product.Template', { id }))[0]
    if (!record) throw error('missing', 'notFound')
    const expected = args.ids == null ? args.expectedRevisionId : revisions[id]
    if (
      (ctx.manifest.modules.website_catalog && expected == null) ||
      (expected != null && (args.confirmed !== true || expected !== (record.revisionId ?? 'initial')))
    )
      throw error('conflict', 'conflict')
    const products = await tx.db.select('product.Product', { templateId: id })
    if (args.active) {
      try {
        if (record.type === 'combo') await validateTemplateCombos(tx, id, await templateComboIds(tx, id))
        await requireActiveCategory(tx, record.categoryId)
      } catch (issue) {
        const refused = categoryFailure(issue) ?? comboFailure(issue)
        if (refused) return refused
        throw issue
      }
    }
    if (
      !args.active &&
      record.active !== false &&
      (await hasOpenDocuments(
        tx,
        products.map((product) => String(product.id)),
      ))
    )
      throw error('inUse', 'conflict')
    entries.push({ record, products })
  }
  for (const { record, products } of entries) {
    if (Boolean(record.active) === args.active) continue
    const revisionId = randomUUID()
    const changed = await tx.db.compareAndSet(
      'product.Template',
      { id: record.id },
      {
        revisionId: record.revisionId ?? null,
        ...(ctx.manifest.modules.stock ? { inventoryRevision: record.inventoryRevision ?? null } : {}),
      },
      {
        active: args.active,
        revisionId,
        ...(ctx.manifest.modules.stock
          ? { inventoryRevision: Number(record.inventoryRevision ?? 0) + 1 }
          : {}),
      },
    )
    if (!('dryRun' in changed) && !changed.matched) throw error('conflict', 'conflict')
    const H = tx.table('product.TemplateStateEvent')
    const previous = args.active
      ? await tx.db.one(
          from(H).where(eq(H.templateId, record.id)).where(eq(H.active, false)).orderBy(desc(H.occurredAt)),
        )
      : null
    // Only revive the SKUs archived by this lifecycle operation. Individually
    // archived or dropped combinations must not become sellable again.
    const activeProductIds = args.active
      ? Array.isArray(previous?.activeProductIds)
        ? previous.activeProductIds.map(String)
        : []
      : products.filter((product) => product.active !== false).map((product) => String(product.id))
    for (const product of products) {
      const active =
        args.active === true &&
        !String(product.combinationKey).startsWith('archived:') &&
        (product.active === true || activeProductIds.includes(String(product.id)))
      if (Boolean(product.active) !== active)
        await tx.db.update('product.Product', { id: product.id }, { active })
    }
    await tx.db.insert('product.TemplateStateEvent', {
      id: revisionId,
      templateId: record.id,
      active: args.active,
      reason: args.active ? null : reason,
      actor: ctx.actor ?? null,
      occurredAt: new Date().toISOString(),
      revisionId,
      activeProductIds,
    })
  }
  return {
    ok: true,
    id: args.id ?? null,
    active: args.active,
    changed: entries.filter(({ record }) => Boolean(record.active) !== args.active).length,
  }
}

export const lifecycleEffects = [
  ...TEMPLATE_COMBO_EFFECTS,
  'read:product.Category',
  'write:product.Category',
  'read:product.Template',
  'write:product.Template',
  'read:product.Product',
  'write:product.Product',
  'write:product.TemplateStateEvent',
  'read:product.TemplateStateEvent',
  'read:sale.OrderLine',
  'read:sale.Order',
  'read:stock.Move',
]
