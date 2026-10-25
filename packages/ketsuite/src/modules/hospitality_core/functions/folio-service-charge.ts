import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec } from '@ketvietlab/ketjs'
import { canonicalDecimalText, compareDecimals } from '../../account/money.ts'
import { dateKeyIn } from '../calendar.ts'
import { MANUAL_CHARGE_TYPES } from '../types.ts'
import { postChargeInTransaction } from '../services.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

/** Desk fees cannot bypass stock fulfillment or impersonate room/outlet charges. */
export const postFolioServiceChargeHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'postFolioServiceCharge', async (tx) => {
    if (!tx.scope.company) reject('folioId', 'folio_missing')
    const folio = await readRecord(tx, 'hospitality_core.Folio', args.folioId)
    if (!folio) reject('folioId', 'folio_missing')
    if (folio.state !== 'open') reject('folioId', 'folio_not_open')
    const property = await propertyAccess(tx, folio.propertyId)
    if (property.closingDate) reject('folioId', 'business_date_locked')
    const type = String(args.type ?? '')
    if (!(MANUAL_CHARGE_TYPES as readonly string[]).includes(type)) reject('type', 'manual_charge_type')
    const whole = (field: string, max: string) => {
      let value: string
      try {
        value = canonicalDecimalText(String(args[field]))
      } catch {
        reject(field, `manual_charge_${field}`)
      }
      if (!/^\d+$/u.test(value) || compareDecimals(value, '1') < 0 || compareDecimals(value, max) > 0)
        reject(field, `manual_charge_${field}`)
      return value
    }
    const quantity = whole('quantity', '20'),
      unitPrice = whole('unitPrice', '50000000')
    const description = String(args.description ?? '').trim()
    if (!description || description.length > 500) reject('description', 'manual_charge_description')
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Folio', folio, args.expectedVersion)
    const now = new Date(),
      today = dateKeyIn(now, String(property.timezone))
    const serviceDate = [today, String(property.businessDate ?? today)].sort().at(-1)!
    const id = `desk-fee:${createHash('sha256')
      .update(JSON.stringify([tx.scope.company, folio.id, args.requestKey]))
      .digest('hex')}`
    const result = await postChargeInTransaction(tx, {
      id,
      folioId: folio.id,
      type,
      description,
      quantity,
      unitPrice,
      fulfillmentKind: 'none',
      occurredAt: now.toISOString(),
      serviceDate,
      sourceKey: id,
    })
    if (!result.ok) return { ...result, ok: false }
    await recordChange(tx, property.id, folio.id, 'folio-service-charge-posted', {
      chargeId: id,
      type,
      quantity,
      unitPrice,
      amount: result.amount,
      description,
      serviceDate,
    })
    return { ...result, ok: true, errors: [] }
  })

export const folioServiceChargeFunctions = {
  postFolioServiceCharge: defineFn({
    input: {
      folioId: 'id',
      type: 'text',
      description: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
      expectedVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', amount: 'decimal?', existing: 'bool?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Folio',
      'write:hospitality_core.Folio',
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Charge',
      'read:hospitality_core.CommandReceipt',
      'write:hospitality_core.CommandReceipt',
      'write:hospitality_core.OperationalChange',
    ],
    idempotent: true,
    handler: postFolioServiceChargeHandler,
  }),
}
