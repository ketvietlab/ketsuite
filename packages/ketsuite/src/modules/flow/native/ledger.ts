import type { Ctx } from '@ketvietlab/ketjs'
import { refuse } from './policy.ts'

/** Mutable at the storage layer only so the separately authorized retention job can purge them. */
export const retainedLedgers = new Set([
  'flow.TaskHistory',
  'flow.SprintReport',
  'flow.FormResponse',
  'flow.CommandReceipt',
])

/** Every normal mutation and extension callback is append-only. This context is already in a transaction. */
export function ledgerContext(ctx: Ctx): Ctx {
  const check = (model: string) => {
    if (retainedLedgers.has(model)) refuse('immutable_ledger')
  }
  const db: Ctx['db'] = {
    ...ctx.db,
    update: (model, where, patch) => {
      check(model)
      return ctx.db.update(model, where, patch)
    },
    compareAndSet: (model, where, expected, patch) => {
      check(model)
      return ctx.db.compareAndSet(model, where, expected, patch)
    },
    del: (query) => {
      check(query.model)
      return ctx.db.del(query)
    },
    commit: (changeset, where) => {
      if (changeset.base || where) check(changeset.model)
      return ctx.db.commit(changeset, where)
    },
  }
  return { ...ctx, db, tx: () => refuse('nested_transaction') }
}
