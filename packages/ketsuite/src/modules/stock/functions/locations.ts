import { LOCATION_USAGES } from '../types.ts'
import { invalid } from '../inventory-validation.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ours } from '../scope.ts'

export async function listLocationsHandler(ctx: Ctx, args: Row) {
  return ours(ctx, 'stock.Location', args.warehouseId ? { warehouseId: args.warehouseId } : {})
}

export async function saveLocationHandler(ctx: Ctx, args: Row) {
  if (!LOCATION_USAGES.includes(args.usage as never))
    return invalid('usage', `phải là: ${LOCATION_USAGES.join(', ')}`)
  if (args.parentId === args.id) return invalid('parentId', 'location không thể là cha của chính nó')
  let parentPath = `${String(args.id)}/`
  if (args.parentId) {
    const parent = (await ours(ctx, 'stock.Location', { id: args.parentId }))[0]
    if (!parent) return invalid('parentId', 'location cha không tồn tại')
    if (String(parent.parentPath).split('/').includes(String(args.id)))
      return invalid('parentId', 'cây location có vòng lặp')
    parentPath = `${String(parent.parentPath)}${String(args.id)}/`
  }
  const existing = (await ours(ctx, 'stock.Location', { id: args.id }))[0]
  const values = { ...args, parentPath, active: true }
  const cs = ctx
    .change('stock.Location', values, existing ?? null)
    .cast(['id', 'name', 'usage', 'parentId', 'parentPath', 'warehouseId', 'active'])
    .required(['name', 'usage'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  // Re-parenting moves a whole subtree, and every row under it stores the path
  // it reaches the root by. Writing only this row left descendants pointing
  // through the old ancestor, and `forecast` anchors on exactly that path — so
  // one location was counted inside its old warehouse and outside its new one.
  // uom.saveUnit rebuilds its tree for the same reason.
  const moved = existing ? String(existing.parentPath) !== parentPath : false
  await ctx.tx(async (tx) => {
    await tx.db.commit(cs, existing ? { id: args.id } : undefined)
    if (!moved) return
    const previous = String(existing!.parentPath)
    for (const descendant of await ours(tx, 'stock.Location')) {
      const path = String(descendant.parentPath)
      if (descendant.id === args.id || !path.startsWith(previous)) continue
      await tx.db.update(
        'stock.Location',
        { id: descendant.id },
        { parentPath: `${parentPath}${path.slice(previous.length)}` },
      )
    }
  })
  return { ok: true, id: args.id }
}

export const locationsFunctions: Record<string, FnSpec> = {
  listLocations: defineFn({
    input: { warehouseId: 'id?' },
    effects: ['read:stock.Location'],
    agent: true,
    handler: listLocationsHandler,
  }),

  saveLocation: defineFn({
    input: { id: 'id', name: 'text', usage: 'text', parentId: 'id?', warehouseId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:stock.Location', 'write:stock.Location'],
    idempotent: true,
    agent: true,
    handler: saveLocationHandler,
  }),
}
