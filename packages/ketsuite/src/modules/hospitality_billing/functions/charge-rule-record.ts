import { auditActorNames } from '../../hospitality_core/functions/audit-actors.ts'
import { randomUUID } from 'node:crypto'
import { asc, desc, defineFn, eq, from, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { CHARGE_TYPES } from '../../hospitality_core/types.ts'
import { claimVersion, readRecord, reject, runCommand } from '../../hospitality_core/functions/command.ts'
const ruleId = (ctx: Ctx, type: unknown) => `charge-rule:${String(ctx.scope.company ?? '')}:${type}`
export const chargeRuleRecordFunctions = {
  getChargeRuleRecord: defineFn({
    input: { id: 'id' },
    output: { record: 'json?' },
    effects: [
      'read:hospitality_billing.ChargeRule',
      'read:hospitality_billing.ChargeRuleChange',
      'read:user.User',
    ],
    handler: async (ctx, args) => {
      const direct = await readRecord(ctx, 'hospitality_billing.ChargeRule', args.id)
      const type = direct?.chargeType ?? args.id
      if (!CHARGE_TYPES.includes(type as (typeof CHARGE_TYPES)[number])) return { record: null }
      const row = direct ?? (await readRecord(ctx, 'hospitality_billing.ChargeRule', ruleId(ctx, type)))
      const H = ctx.table('hospitality_billing.ChargeRuleChange')
      const history = row
        ? await ctx.db.all(
            from(H)
              .where(eq(H.companyId!, ctx.scope.company), eq(H.chargeRuleId!, row.id))
              .orderBy(desc(H.occurredAt!), desc(H.id))
              .limit(50),
          )
        : []
      const actors = await auditActorNames(ctx, history)
      return {
        record: {
          id: row?.id ?? ruleId(ctx, type),
          chargeType: type,
          version: row?.version ?? 0,
          incomeAccountId: row?.incomeAccountId ?? null,
          taxId: row?.taxId ?? null,
          taxAccountId: row?.taxAccountId ?? null,
          taxExempt: row?.taxExempt === true,
          taxExemptReason: row?.taxExemptReason ?? '',
          history: history.map((h) => ({
            occurredAt: h.occurredAt,
            actorId: h.actorId,
            actorName: actors.get(h.actorId) ?? null,
            before: h.before,
            after: h.after,
          })),
        },
      }
    },
  }),
  lookupChargeRuleAccounts: defineFn({
    input: { search: 'text?', limit: 'int?', id: 'id?', kind: 'text?' },
    effects: ['read:account.Account'],
    handler: async (ctx, args) => {
      const T = ctx.table('account.Account')
      let query = from(T).where(eq(T.companyId!, ctx.scope.company), eq(T.active!, true))
      if (args.kind !== 'tax') query = query.where(inArray(T.accountType!, ['income', 'income_other']))
      if (args.id) query = query.where(eq(T.id, args.id))
      if (args.search) {
        const pattern = `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`
        query = query.where(or(ilike(T.name!, pattern, true), ilike(T.code!, pattern, true)))
      }
      return (
        await ctx.db.all(
          query.orderBy(asc(T.code!), asc(T.id)).limit(Math.min(100, Math.max(1, Number(args.limit) || 20))),
        )
      ).map((r) => ({ id: r.id, name: `${r.code} · ${r.name}` }))
    },
  }),
  lookupChargeRuleTaxes: defineFn({
    input: { search: 'text?', limit: 'int?', id: 'id?' },
    effects: ['read:account.Tax'],
    handler: async (ctx, args) => {
      const T = ctx.table('account.Tax')
      let query = from(T).where(
        eq(T.companyId!, ctx.scope.company),
        eq(T.active!, true),
        inArray(T.typeTaxUse!, ['sale', 'none']),
      )
      if (args.id) query = query.where(eq(T.id, args.id))
      if (args.search)
        query = query.where(
          ilike(T.name!, `%${likeLiteral(String(args.search).trim().slice(0, 200))}%`, true),
        )
      return (
        await ctx.db.all(
          query.orderBy(asc(T.name!), asc(T.id)).limit(Math.min(100, Math.max(1, Number(args.limit) || 20))),
        )
      ).map((r) => ({ id: r.id, name: r.name }))
    },
  }),
}
export function chargeRuleCommands(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  const spec = functions.saveChargeRule!
  return {
    ...functions,
    saveChargeRule: {
      ...spec,
      input: { ...spec.input, expectedVersion: 'int?', requestKey: 'text?' },
      effects: [
        ...new Set([
          ...(spec.effects ?? []),
          'read:hospitality_core.CommandReceipt',
          'write:hospitality_core.CommandReceipt',
          'write:hospitality_billing.ChargeRuleChange',
        ]),
      ],
      handler: (ctx, args) =>
        runCommand(ctx, args, 'saveChargeRule', async (tx) => {
          const id = ruleId(tx, args.chargeType),
            row = await readRecord(tx, 'hospitality_billing.ChargeRule', id)
          if (row) await claimVersion(tx, 'hospitality_billing.ChargeRule', row, args.expectedVersion)
          else {
            if (Number(args.expectedVersion ?? 0) !== 0) reject('expectedVersion', 'transition_conflict')
            const inserted = await tx.db.insertIfAbsent('hospitality_billing.ChargeRule', {
              id,
              chargeType: args.chargeType,
              taxExempt: false,
              version: 1,
              updatedAt: new Date().toISOString(),
            })
            if ('inserted' in inserted && !inserted.inserted) reject('expectedVersion', 'transition_conflict')
          }
          const nested: Ctx = { ...tx, tx: (run) => run(nested) }
          const result = (await spec.handler(nested, args)) as { ok: boolean }
          if (result.ok) {
            const updated = await readRecord(tx, 'hospitality_billing.ChargeRule', id)
            const fields = [
              'chargeType',
              'incomeAccountId',
              'taxId',
              'taxAccountId',
              'taxExempt',
              'taxExemptReason',
            ]
            const snapshot = (r: typeof row) =>
              r ? Object.fromEntries(fields.map((key) => [key, r[key] ?? null])) : null
            await tx.db.insert('hospitality_billing.ChargeRuleChange', {
              id: randomUUID(),
              chargeRuleId: id,
              actorId: tx.actor ?? null,
              before: snapshot(row),
              after: snapshot(updated),
              occurredAt: new Date().toISOString(),
            })
          }
          return result
        }),
    },
  }
}
