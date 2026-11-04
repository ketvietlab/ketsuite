import { randomUUID } from 'node:crypto'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { company } from './scope.ts'

export const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

export const n = (value: unknown): number => Number(value ?? 0)

export const companyKey = (ctx: Ctx, ...parts: unknown[]): string =>
  [company(ctx), ...parts.map(String)].join(':')

export class InventoryRefused extends Error {
  result: Row
  constructor(result: Row) {
    super('inventory operation refused')
    this.result = result
  }
}

export class PickingConflict extends Error {}

export const claimInventoryRevision = async (
  ctx: Ctx,
  template: Row,
  expected: unknown,
): Promise<boolean> => {
  const revision = n(template.inventoryRevision)
  if (revision !== n(expected)) return false
  const changed = await ctx.db.compareAndSet(
    'product.Template',
    { id: template.id },
    { inventoryRevision: template.inventoryRevision ?? null, revisionId: template.revisionId ?? null },
    { inventoryRevision: revision + 1, revisionId: randomUUID() },
  )
  return 'dryRun' in changed || changed.matched
}
