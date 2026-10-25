import { createHash } from 'node:crypto'
import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { savePartnerRecord } from '../../partner/functions/partners.ts'
import { dateKeyIn } from '../calendar.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

const text = (value: unknown) => String(value ?? '').trim()
const problem = (index: number, field: string, code: string): never => reject(`guest-${index}-${field}`, code)

export function validateArrivalPeople(input: unknown, count: number, today: string) {
  if (!Array.isArray(input) || input.length !== count || count < 1 || count > 50)
    reject('guests', 'arrival_guest_count')
  const documents = new Set<string>()
  return input.map((value, index) => {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
    const fullName = text(item.fullName),
      type = text(item.type),
      number = text(item.number).replace(/\s/g, '').toUpperCase(),
      birth = text(item.birth),
      nationality = text(item.nationality).toUpperCase(),
      gender = text(item.gender)
    if (!fullName || fullName.length > 200) problem(index, 'fullName', 'required')
    if (!['cccd', 'passport'].includes(type)) problem(index, 'type', 'document_type')
    if (
      !['VN', 'KR', 'CN', 'TW', 'JP', 'RU', 'IN', 'AU', 'US', 'GB', 'FR', 'DE', 'SG', 'MY', 'TH'].includes(
        nationality,
      )
    )
      problem(index, 'nationality', 'arrival_guest_nationality')
    if (type === 'cccd' && nationality !== 'VN') problem(index, 'type', 'arrival_guest_citizen')
    if (!(type === 'cccd' ? /^\d{12}$/ : /^[A-Z0-9]{6,9}$/).test(number))
      problem(index, 'number', 'arrival_guest_document')
    const date = new Date(`${birth}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== birth ||
      birth < '1900-01-01' ||
      birth >= today
    )
      problem(index, 'birth', 'arrival_guest_birth')
    if (!['male', 'female', 'other'].includes(gender)) problem(index, 'gender', 'gender')
    const key = `${type}:${nationality}:${number}`
    if (documents.has(key)) problem(index, 'number', 'arrival_guest_duplicate')
    documents.add(key)
    return { fullName, type, number, birth, nationality, gender, partnerId: text(item.partnerId) }
  })
}

/** Identity data stays in GuestDocument; the operational audit contains only the number of guests. */
export async function declareArrivalGuestsInTransaction(ctx: Ctx, stay: Row, input: unknown) {
  if (!ctx.scope.company || stay.state !== 'draft') reject('stayId', 'stay_cannot_check_in')
  const property = await propertyAccess(ctx, stay.propertyId)
  if (property.closingDate) reject('stayId', 'business_date_locked')
  const count = Number(stay.adults)
  const people = validateArrivalPeople(input, count, dateKeyIn(new Date(), String(property.timezone)))
  const G = ctx.table('hospitality_core.StayGuest')
  const guests = await ctx.db.all(from(G).where(eq(G.stayId, stay.id)).limit(51))
  const touched = new Set<string>(),
    partners = new Set<string>()
  for (const [index, person] of people.entries()) {
    const digest = createHash('sha256')
      .update(JSON.stringify([ctx.scope.company, stay.id, index]))
      .digest('hex')
    const generatedPartner = `arrival-guest:${digest}`
    const partnerId = index === 0 ? String(stay.partnerId) : person.partnerId || generatedPartner
    if (index === 0 && person.partnerId && person.partnerId !== partnerId)
      problem(index, 'partnerId', 'primary_guest_mismatch')
    if (partners.has(partnerId)) problem(index, 'partnerId', 'arrival_guest_duplicate')
    partners.add(partnerId)
    const knownPartner = await readRecord(ctx, 'partner.Partner', partnerId)
    if (partnerId === generatedPartner && !knownPartner) {
      const saved = await savePartnerRecord(ctx, {
        id: partnerId,
        name: person.fullName,
        kind: 'person',
        contactConsent: false,
      })
      if (!saved.ok) problem(index, 'fullName', 'required')
    } else {
      const partner = knownPartner
      if (!partner || (index !== 0 && partner.kind !== 'person') || partner.active === false)
        problem(index, 'partnerId', 'partner_missing')
    }
    const existing = guests.find((guest) => guest.partnerId === partnerId)
    const guestId = existing?.id ?? `arrival-guest:${digest}`
    if (index === 0 && guests.some((guest) => guest.primary === true && guest.id !== guestId))
      problem(index, 'partnerId', 'primary_guest_unique')
    touched.add(String(guestId))
    const values = {
      stayId: stay.id,
      propertyId: stay.propertyId,
      partnerId,
      displayName: person.fullName,
      primary: index === 0,
      primaryKey: index === 0 ? 'primary' : null,
    }
    if (existing) await ctx.db.update('hospitality_core.StayGuest', { id: guestId }, values)
    else await ctx.db.insert('hospitality_core.StayGuest', { id: guestId, ...values })
    const id = `${guestId}:arrival-document`
    const document = await readRecord(ctx, 'hospitality_core.GuestDocument', id)
    if (document && (document.stayId !== stay.id || document.partnerId !== partnerId))
      problem(index, 'number', 'document_owner_immutable')
    const evidence = {
      stayId: stay.id,
      partnerId,
      type: person.type,
      number: person.number,
      fullName: person.fullName,
      dateOfBirth: `${person.birth}T00:00:00.000Z`,
      gender: person.gender,
      nationality: person.nationality,
      ocrState: 'pending',
    }
    if (document) await ctx.db.update('hospitality_core.GuestDocument', { id }, evidence)
    else await ctx.db.insert('hospitality_core.GuestDocument', { id, ...evidence })
  }
  if (guests.some((guest) => !touched.has(String(guest.id)))) reject('guests', 'arrival_guest_count')
  await recordChange(ctx, property.id, stay.id, 'declareArrivalGuests', { count })
  return { ok: true, id: stay.id, count }
}

/** Existing declarations can be reused without returning identity fields to an operational reader. */
export async function assertArrivalGuestsDeclared(ctx: Ctx, stay: Row, property: Row) {
  const G = ctx.table('hospitality_core.StayGuest'),
    D = ctx.table('hospitality_core.GuestDocument')
  const guests = await ctx.db.all(
    from(G).where(eq(G.stayId, stay.id), eq(G.propertyId, stay.propertyId)).limit(51),
  )
  if (
    guests.length !== Number(stay.adults) ||
    guests.filter((guest) => guest.primary === true && guest.partnerId === stay.partnerId).length !== 1
  )
    reject('guests', 'arrival_declaration_required')
  const documents = await ctx.db.all(from(D).where(eq(D.stayId, stay.id)).limit(201))
  const people = guests.map((guest) => {
    const document =
      documents.find((item) => item.id === `${guest.id}:arrival-document`) ??
      documents.find((item) => item.partnerId === guest.partnerId)
    if (!document || document.partnerId !== guest.partnerId) reject('guests', 'arrival_declaration_required')
    return { ...document, birth: String(document.dateOfBirth ?? '').slice(0, 10) }
  })
  // Return a general message for stored documents; do not expose the document or individual field details.
  try {
    validateArrivalPeople(people, Number(stay.adults), dateKeyIn(new Date(), String(property.timezone)))
  } catch {
    reject('guests', 'arrival_declaration_required')
  }
}

export const ARRIVAL_GUEST_EFFECTS = [
  'read:hospitality_core.Stay',
  'write:hospitality_core.Stay',
  'read:hospitality_core.Property',
  'write:hospitality_core.Property',
  'read:hospitality_core.StayGuest',
  'write:hospitality_core.StayGuest',
  'read:hospitality_core.GuestDocument',
  'write:hospitality_core.GuestDocument',
  'read:partner.Partner',
  'write:partner.Partner',
  'write:hospitality_core.OperationalChange',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
]
export const declareArrivalGuestsHandler: FnSpec['handler'] = (ctx, args) =>
  runCommand(ctx, args, 'declareArrivalGuests', async (tx) => {
    if (!tx.scope.company) reject('stayId', 'stay_missing')
    const stay = await readRecord(tx, 'hospitality_core.Stay', args.stayId)
    if (!stay) reject('stayId', 'stay_missing')
    const property = await propertyAccess(tx, stay.propertyId)
    await claimVersion(tx, 'hospitality_core.Property', property, property.version)
    await claimVersion(tx, 'hospitality_core.Stay', stay, args.expectedVersion)
    return declareArrivalGuestsInTransaction(tx, stay, args.guests)
  })
export const arrivalGuestFunctions = {
  declareArrivalGuests: defineFn({
    input: { stayId: 'id', guests: 'json', expectedVersion: 'int', requestKey: 'text' },
    output: { ok: 'bool', id: 'id?', count: 'int?', errors: 'json?' },
    effects: ARRIVAL_GUEST_EFFECTS,
    idempotent: true,
    handler: declareArrivalGuestsHandler,
  }),
}
