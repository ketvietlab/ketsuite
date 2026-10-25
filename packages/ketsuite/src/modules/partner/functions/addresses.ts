import { defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ADDRESS_USES } from '../types.ts'
import { validateAddress } from '../../address/format.ts'
import {
  type Issue,
  issue,
  invalid,
  DefaultConflict,
  changeIssues,
  canonicalAddress,
  presentationOf,
  snapshotPartnerAddress,
  selectDefault,
} from './helpers.ts'

export async function listAddressesHandler(ctx: Ctx, args: Row) {
  const A = ctx.table('partner.Address')
  let query = from(A).where(eq(A.partnerId, args.partnerId))
  if (args.use) query = query.where(eq(A.use, args.use))
  const rows = await ctx.db.all(query)
  const D = ctx.table('partner.AddressDefault')
  const defaults = new Set(
    (await ctx.db.all(from(D).select(D.addressId).where(eq(D.partnerId, args.partnerId)))).map(
      (row) => row.addressId,
    ),
  )
  return Promise.all(
    rows.map(async (row) => ({ ...(await presentationOf(ctx, row)), isDefault: defaults.has(row.id) })),
  )
}

export async function saveAddressHandler(ctx: Ctx, a: Row) {
  const errors: Issue[] = []
  const address = canonicalAddress(a)
  if (!ADDRESS_USES.includes(String(a.use) as never))
    errors.push(issue('use', 'partner.error.addressUse', { allowed: ADDRESS_USES }))
  if (!address.street1) errors.push(issue('street1', 'partner.error.required'))
  if (!/^[A-Z]{2}$/.test(address.countryCode)) errors.push(issue('countryId', 'address.error.countryCode'))
  const country = /^[A-Z]{2}$/.test(address.countryCode)
    ? await ctx.db.one(
        from(ctx.table('address.Country')).where(eq(ctx.table('address.Country').id, address.countryCode)),
      )
    : null
  if (country) {
    const checked = await validateAddress(ctx, {
      ...address,
      countryId: address.countryCode,
    })
    errors.push(...checked.issues)
  } else if (address.divisionId) {
    errors.push(issue('divisionId', 'address.error.catalogNotInstalled'))
  }
  if (errors.length) return invalid(errors)

  try {
    return await ctx.tx(async (tx) => {
      const A = tx.table('partner.Address')
      const D = tx.table('partner.AddressDefault')
      const existing = await tx.db.one(from(A).where(eq(A.id, a.id)))
      if (existing && existing.partnerId !== a.partnerId)
        return invalid([issue('partnerId', 'partner.error.addressOwner')])
      if (!existing) {
        const P = tx.table('partner.Partner')
        if (!(await tx.db.one(from(P).where(eq(P.id, a.partnerId)))))
          return invalid([issue('partnerId', 'partner.error.partnerMissing')])
      }
      const values = {
        id: a.id,
        partnerId: a.partnerId,
        use: a.use,
        ...address,
        countryId: country ? address.countryCode : null,
      }
      const cs = tx
        .change('partner.Address', values, existing)
        .cast([
          'id',
          'partnerId',
          'use',
          'street1',
          'street2',
          'locality',
          'postalCode',
          'countryCode',
          'countryId',
          'divisionId',
          'divisionText',
        ])
      if (!cs.valid) return invalid(changeIssues(cs.errors))
      await tx.db.commit(cs, existing ? { id: a.id } : undefined)
      if (a.isDefault !== true || (existing && existing.use !== a.use)) {
        const previous = await tx.db.one(from(D).where(eq(D.addressId, a.id)))
        if (previous) await tx.db.del(deleteFrom(D).where(eq(D.id, previous.id)))
      }
      if (
        a.isDefault === true &&
        !(await selectDefault(tx, String(a.partnerId), String(a.use), String(a.id)))
      )
        throw new DefaultConflict()
      return { ok: true, id: a.id }
    })
  } catch (error) {
    if (error instanceof DefaultConflict)
      return invalid([issue('isDefault', 'partner.error.defaultConflict')])
    throw error
  }
}

export async function snapshotAddressHandler(ctx: Ctx, args: Row) {
  const snapshot = await snapshotPartnerAddress(ctx, String(args.id))
  return snapshot ? { ok: true, snapshot } : invalid([issue('id', 'partner.error.addressMissing')])
}

export const addressesFunctions: Record<string, FnSpec> = {
  listAddresses: defineFn({
    input: { partnerId: 'id', use: 'text?' },
    output: {
      id: 'id',
      partnerId: 'id',
      use: 'text',
      street1: 'text',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryCode: 'text',
      countryId: 'id?',
      divisionId: 'id?',
      divisionText: 'text?',
      oneLine: 'text',
      isDefault: 'bool',
    },
    effects: [
      'read:partner.Address',
      'read:partner.AddressDefault',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: listAddressesHandler,
  }),
  saveAddress: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      use: 'text',
      street: 'text?',
      street1: 'text?',
      street2: 'text?',
      city: 'text?',
      locality: 'text?',
      zip: 'text?',
      postalCode: 'text?',
      state: 'text?',
      divisionText: 'text?',
      country: 'text?',
      countryCode: 'text?',
      countryId: 'id?',
      divisionId: 'id?',
      isDefault: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:partner.Address',
      'read:partner.AddressDefault',
      'write:partner.Address',
      'write:partner.AddressDefault',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    idempotent: true,
    agent: true,
    handler: saveAddressHandler,
  }),
  snapshotAddress: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', snapshot: 'json?', errors: 'json?' },
    effects: [
      'read:partner.Address',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: snapshotAddressHandler,
  }),
}
