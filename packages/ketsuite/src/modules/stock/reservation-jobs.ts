import { asc, defineJob, from, inArray } from '@ketvietlab/ketjs'
import type { JobSpec } from '@ketvietlab/ketjs'
import { pickingsFunctions, reservePickingsHandler } from './functions/pickings.ts'

const hourStamp = (now: Date): string => now.toISOString().slice(0, 13)

/**
 * K60: a warehouse that reserves on confirmation or by date holds goods without anyone pressing a
 * button: by date once a transfer's day comes, and either way for a transfer still short when goods
 * turn up some other way (stock counted in, a transfer edited). The schedule runs per tenant; each
 * company with such a warehouse gets its own run, at most one per hour. Goods a receipt, transfer or
 * cancellation frees do not wait for the hour: `reserveFreedTransfers` offers them as it commits.
 */
export const reservationJobs: Record<string, JobSpec> = {
  reserveDueTransfers: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    schedule: { every: '1h' },
    effects: ['read:stock.Warehouse', 'enqueue:stock.reserveDueCompanyTransfers'],
    handler: async (ctx) => {
      const Warehouse = ctx.table('stock.Warehouse')
      const warehouses = await ctx.db.all(
        from(Warehouse)
          .where(inArray(Warehouse.reservationMethod, ['at_confirm', 'by_date']))
          .orderBy(asc(Warehouse.id)),
      )
      const companies = new Set<string>()
      for (const warehouse of warehouses)
        if (warehouse.companyId != null && warehouse.active !== false)
          companies.add(String(warehouse.companyId))
      const stamp = hourStamp(new Date())
      for (const company of [...companies].sort())
        await ctx.jobs.enqueue(
          'stock.reserveDueCompanyTransfers',
          {},
          { company, uniqueKey: `stock.reserveDue:${company}:${stamp}` },
        )
    },
  }),

  reserveDueCompanyTransfers: defineJob({
    input: {},
    idempotent: true,
    effects: pickingsFunctions.reservePickings!.effects ?? [],
    handler: async (ctx) => {
      await reservePickingsHandler(ctx, { due: true })
    },
  }),

  reserveFreedTransfers: defineJob({
    input: { productIds: 'json' },
    idempotent: true,
    effects: pickingsFunctions.reservePickings!.effects ?? [],
    handler: async (ctx, args) => {
      await reservePickingsHandler(ctx, { due: true, productIds: args.productIds })
    },
  }),
}
