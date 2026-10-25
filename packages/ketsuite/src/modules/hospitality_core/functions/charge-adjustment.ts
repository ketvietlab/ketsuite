import { randomUUID } from 'node:crypto'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import {
  addDecimals,
  canonicalDecimalText,
  compareDecimals,
  decimalSign,
  moneyMinor,
  scaleOf,
} from '../../account/money.ts'
import { dateKeyIn } from '../calendar.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

/** Closed-day fees stay immutable. A correction is a signed line on the currently open business day. */
export const adjustChargeHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'adjustCharge', async (tx) => {
    const original = await readRecord(tx, 'hospitality_core.Charge', args.chargeId)
    const folio = await readRecord(tx, 'hospitality_core.Folio', args.folioId)
    if (
      !original ||
      !folio ||
      original.folioId !== folio.id ||
      original.state !== 'active' ||
      original.adjustsChargeId
    )
      reject('chargeId', 'charge_missing')
    if (folio.state !== 'open') reject('folioId', 'folio_not_open')
    const property = await propertyAccess(tx, folio.propertyId)
    if (property.closingDate) reject('date', 'business_date_locked')
    const originalDate = String(
      original.serviceDate ?? dateKeyIn(new Date(String(original.occurredAt)), String(property.timezone)),
    )
    const currentDay = String(property.businessDate ?? dateKeyIn(new Date(), String(property.timezone)))
    if (originalDate >= currentDay) reject('chargeId', 'adjustment_not_locked')
    const reason = String(args.reason ?? '').trim()
    if (reason.length < 3 || reason.length > 2000) reject('reason', 'adjustment_reason')
    let amount: string
    const company = await readRecord(tx, 'company.Company', tx.scope.company)
    try {
      amount = canonicalDecimalText(String(args.amount))
      moneyMinor(amount, scaleOf(String(company?.currency ?? 'VND')))
    } catch {
      reject('amount', 'adjustment_amount')
    }
    if (decimalSign(amount) === 0) reject('amount', 'adjustment_amount')
    const C = tx.table('hospitality_core.Charge')
    const adjustments = await tx.db.all(
      from(C).where(
        eq(C.companyId!, tx.scope.company),
        eq(C.adjustsChargeId!, original.id),
        eq(C.state, 'active'),
      ),
    )
    const effective = adjustments.reduce(
      (sum, row) => addDecimals(sum, String(row.amount)),
      addDecimals(String(original.amount), amount),
    )
    if (
      (decimalSign(String(original.amount)) >= 0 && compareDecimals(effective, '0') < 0) ||
      (decimalSign(String(original.amount)) < 0 && compareDecimals(effective, '0') > 0)
    )
      reject('amount', 'adjustment_amount')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Folio', folio, args.expectedVersion)
    const id = randomUUID()
    await tx.db.insert('hospitality_core.Charge', {
      id,
      folioId: folio.id,
      stayId: original.stayId ?? null,
      description: reason,
      type: original.type,
      fulfillmentKind: 'none',
      quantity: '1',
      unitPrice: amount,
      amount,
      occurredAt: new Date().toISOString(),
      serviceDate: currentDay,
      sourceKey: `adjustment:${args.requestKey}`,
      state: 'active',
      adjustsChargeId: original.id,
      adjustmentReason: reason,
    })
    await tx.db.update(
      'hospitality_core.Folio',
      { id: folio.id },
      { amountTotal: addDecimals(String(folio.amountTotal), amount) },
    )
    await recordChange(tx, property.id, folio.id, 'charge-adjusted', {
      chargeId: original.id,
      adjustmentId: id,
      amount,
      originalDate,
      serviceDate: currentDay,
      reason,
    })
    return { ok: true, id, errors: [] }
  })

export const chargeAdjustmentFunctions: Record<string, FnSpec> = {
  adjustCharge: defineFn({
    input: {
      folioId: 'id',
      chargeId: 'id',
      amount: 'decimal',
      reason: 'text',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'read:hospitality_core.Folio',
      'write:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Charge',
      'read:company.Company',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
    ],
    idempotent: true,
    handler: adjustChargeHandler,
  }),
}
