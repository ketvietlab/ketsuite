import { createHash } from 'node:crypto'
import { asc, defineFn, eq, from, ilike, inArray, likeLiteral, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { addCalendarDays, dateKeyIn, zonedDateTime } from '../calendar.ts'
import { cancellationTerms, planReservation, reservationQuoteEffects } from '../operations.ts'
import { earlyArrivalAmount, beforeArrivalTime } from './arrival-fee.ts'
import { availableRoomsForPeriod, countAvailableRoomsForPeriod } from './reservation-workspace.ts'
import { CommandRejected, hasPropertyScope, propertyAccess, readRecord, reject } from './command.ts'

export const DESK_BOOKING_LIMITS = { horizon: 365, nights: 30, adults: 8, children: 6, note: 500 } as const
export const DESK_SEARCH_INPUT = {
  propertyId: 'id',
  arrival: 'text',
  departure: 'text',
  adults: 'int',
  children: 'int',
  walkIn: 'bool?',
} as const

/** Public search parameters contain no guest/contact/document data. */
export async function deskSearchPlan(ctx: Ctx, args: Record<string, unknown>) {
  if (!ctx.scope.company) reject('propertyId', 'property_missing')
  const property = await propertyAccess(ctx, args.propertyId)
  if (!property.active || property.lifecycle !== 'active') reject('propertyId', 'property_not_open')
  const timezone = String(property.timezone),
    civil = dateKeyIn(new Date(), timezone)
  const today = [civil, String(property.businessDate ?? civil)].sort().at(-1)!
  const arrival = String(args.arrival ?? ''),
    departure = String(args.departure ?? '')
  for (const [field, day] of [
    ['arrival', arrival],
    ['departure', departure],
  ]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day!) ||
      !Number.isFinite(Date.parse(day!)) ||
      addCalendarDays(day!, 0) !== day
    )
      reject(field!, 'date')
  }
  if (arrival < today) reject('arrival', 'desk_booking_past')
  if (arrival > addCalendarDays(today, DESK_BOOKING_LIMITS.horizon)) reject('arrival', 'desk_booking_horizon')
  const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000)
  if (nights < 1 || nights > DESK_BOOKING_LIMITS.nights) reject('departure', 'desk_booking_nights')
  const adults = Number(args.adults),
    children = Number(args.children)
  if (!Number.isInteger(adults) || adults < 1 || adults > DESK_BOOKING_LIMITS.adults)
    reject('adults', 'desk_booking_adults')
  if (!Number.isInteger(children) || children < 0 || children > DESK_BOOKING_LIMITS.children)
    reject('children', 'desk_booking_children')
  if (args.walkIn && (arrival !== today || today !== civil)) reject('arrival', 'desk_walk_in_day')
  const clock = (day: string, value: unknown) => {
    const [hour, minute] = String(value).split(':').map(Number)
    return zonedDateTime(day, hour!, minute!, timezone).toISOString()
  }
  return {
    property,
    today,
    arrival,
    departure,
    adults,
    children,
    nights,
    checkIn: clock(arrival, property.defaultCheckIn),
    checkOut: clock(departure, property.defaultCheckOut),
    walkIn: args.walkIn === true,
  }
}

/** One authoritative offer, also rerun inside the confirmation transaction. */
export async function deskBookingOffer(ctx: Ctx, args: Record<string, unknown>) {
  const search = await deskSearchPlan(ctx, args)
  const rate = await readRecord(ctx, 'hospitality_core.RatePlan', args.ratePlanId)
  if (!rate || rate.propertyId !== search.property.id || rate.active !== true || rate.rateType !== 'nightly')
    reject('ratePlanId', 'rate_plan_invalid')
  const type = await readRecord(ctx, 'hospitality_core.RoomType', rate.roomTypeId)
  if (!type || type.propertyId !== search.property.id || type.active !== true)
    reject('ratePlanId', 'rate_plan_invalid')
  if (search.adults > Number(type.maxAdults) || search.children > Number(type.maxChildren))
    reject('adults', 'desk_booking_capacity')
  const plan = await planReservation(ctx, {
    propertyId: search.property.id,
    roomTypeId: type.id,
    ratePlanId: rate.id,
    bookingType: 'nightly',
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    adults: search.adults,
    children: search.children,
  })
  if (plan.errors.length || !plan.schedule) throw new CommandRejected({ ok: false, errors: plan.errors })
  const terms = await cancellationTerms(ctx, search.property.id, type.id, rate.cancellationPolicyId)
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        search.property.id,
        type.id,
        rate.id,
        rate.version,
        plan.rate,
        plan.schedule!.amountTotal,
        search.checkIn,
        search.checkOut,
        search.adults,
        search.children,
        search.walkIn,
        terms,
      ]),
    )
    .digest('hex')
  return { ...search, rate, type, plan, terms, fingerprint }
}

export const getDeskBookingContextHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return { record: null }
  const P = ctx.table('hospitality_core.Property')
  let query = from(P).where(
    eq(P.companyId!, ctx.scope.company),
    eq(P.active, true),
    eq(P.lifecycle!, 'active'),
  )
  if (ctx.scope.branches) query = query.where(inArray(P.branchId!, ctx.scope.branches))
  if (args.propertyId) query = query.where(eq(P.id, args.propertyId))
  const property = await ctx.db.one(query.orderBy(asc(P.name), asc(P.id)))
  if (!property || !hasPropertyScope(ctx, property)) return { record: null }
  const company = await readRecord(ctx, 'company.Company', ctx.scope.company)
  const civil = dateKeyIn(new Date(), String(property.timezone))
  const today = [civil, String(property.businessDate ?? civil)].sort().at(-1)!
  return {
    record: {
      property: Object.fromEntries(
        ['id', 'name', 'timezone', 'version', 'defaultCheckIn', 'defaultCheckOut', 'businessDate'].map(
          (key) => [key, property[key] ?? null],
        ),
      ),
      today,
      departure: addCalendarDays(today, 1),
      currency: company?.currency ?? 'VND',
    },
  }
}

export const searchDeskOffersHandler: FnSpec['handler'] = async (ctx, args) => {
  try {
    const search = await deskSearchPlan(ctx, args)
    const R = ctx.table('hospitality_core.RatePlan')
    let query = from(R).where(
      eq(R.companyId!, ctx.scope.company),
      eq(R.propertyId, search.property.id),
      eq(R.active, true),
      eq(R.rateType, 'nightly'),
    )
    if (args.ratePlanId) query = query.where(eq(R.id, args.ratePlanId))
    const total = await ctx.db.count(query),
      pages = Math.max(1, Math.ceil(total / 12)),
      page = Math.max(1, Math.min(pages, Number(args.page) || 1))
    const rates = await ctx.db.all(
      query
        .orderBy(asc(R.name), asc(R.id))
        .limit(12)
        .offset((page - 1) * 12),
    )
    const rows: Row[] = []
    const readyByType = new Map<string, number>()
    for (const rate of rates) {
      try {
        const offer = await deskBookingOffer(ctx, { ...args, ratePlanId: rate.id })
        const typeKey = String(offer.type.id)
        if (search.walkIn && !readyByType.has(typeKey))
          readyByType.set(
            typeKey,
            await countAvailableRoomsForPeriod(
              ctx,
              search.property,
              {
                roomTypeId: offer.type.id,
                start: new Date().toISOString(),
                end: search.checkOut,
                minimumCapacity: search.adults + search.children,
              },
              { readyOnly: true },
            ),
          )
        const available = search.walkIn
          ? Math.min(offer.plan.minimumAvailable ?? 0, readyByType.get(typeKey) ?? 0)
          : (offer.plan.minimumAvailable ?? 0)
        const ready = available > 0
        rows.push({
          id: rate.id,
          ratePlanId: rate.id,
          rateName: rate.name,
          roomTypeId: offer.type.id,
          roomTypeName: offer.type.name,
          rate: offer.plan.rate,
          amountTotal: offer.plan.schedule!.amountTotal,
          nights: search.nights,
          available,
          rateVersion: Number(rate.version ?? 0),
          cancellationPolicyType: offer.terms.cancellationPolicyType ?? null,
          cancellationFeeRule: offer.terms.cancellationFeeRule ?? null,
          freeCancellationHours: offer.terms.freeCancellationHours ?? null,
          penaltyPercent: offer.terms.penaltyPercent ?? null,
          canBook: ready,
          errors: ready
            ? []
            : [
                {
                  field: 'roomId',
                  code: 'no_available_room',
                  messageKey: 'hospitality_core.validation.no_available_room',
                },
              ],
        })
      } catch (error) {
        if (!(error instanceof CommandRejected)) throw error
        const type = await readRecord(ctx, 'hospitality_core.RoomType', rate.roomTypeId)
        rows.push({
          id: rate.id,
          ratePlanId: rate.id,
          rateName: rate.name,
          roomTypeId: rate.roomTypeId,
          roomTypeName: type?.name ?? null,
          canBook: false,
          errors: error.result.errors ?? [],
        })
      }
    }
    return {
      ok: true,
      rows,
      total,
      pages,
      page,
      query: {
        propertyId: search.property.id,
        arrival: search.arrival,
        departure: search.departure,
        adults: search.adults,
        children: search.children,
        walkIn: search.walkIn,
      },
      errors: [],
    }
  } catch (error) {
    if (error instanceof CommandRejected) return error.result
    throw error
  }
}

export const lookupDeskGuestsHandler: FnSpec['handler'] = async (ctx, args) => {
  if (!ctx.scope.company) return []
  const P = ctx.table('partner.Partner')
  let query = from(P).where(eq(P.kind, 'person'), eq(P.active, true))
  if (args.id) query = query.where(eq(P.id, args.id))
  const term = String(args.search ?? '')
    .trim()
    .slice(0, 100)
  if (!args.id && term.length < 2) return []
  if (term) {
    const pattern = `%${likeLiteral(term)}%`
    query = query.where(
      or(ilike(P.name, pattern, true), ilike(P.phone!, pattern, true), ilike(P.email!, pattern, true)),
    )
  }
  return ctx.db.all(
    query
      .select(P.id, P.name, P.phone!, P.email!)
      .orderBy(asc(P.name), asc(P.id))
      .limit(Math.min(20, Math.max(1, Number(args.limit) || 20))),
  )
}

export const lookupDeskRoomsHandler: FnSpec['handler'] = async (ctx, args) => {
  try {
    const offer = await deskBookingOffer(ctx, { ...args, walkIn: true })
    return availableRoomsForPeriod(
      ctx,
      offer.property,
      {
        roomTypeId: offer.type.id,
        start: new Date().toISOString(),
        end: offer.checkOut,
        minimumCapacity: Number(offer.adults) + Number(offer.children),
      },
      { ...args, readyOnly: true },
    )
  } catch (error) {
    if (error instanceof CommandRejected) return []
    throw error
  }
}
export const getDeskBookingQuoteHandler: FnSpec['handler'] = async (ctx, args) => {
  try {
    const offer = await deskBookingOffer(ctx, args)
    return {
      ok: true,
      quote: {
        fingerprint: offer.fingerprint,
        ratePlanId: offer.rate.id,
        rateName: offer.rate.name,
        roomTypeId: offer.type.id,
        roomTypeName: offer.type.name,
        rate: offer.plan.rate,
        amountTotal: offer.plan.schedule!.amountTotal,
        nights: offer.nights,
        available: offer.plan.minimumAvailable,
        rateVersion: Number(offer.rate.version ?? 0),
        earlyArrival:
          offer.walkIn &&
          beforeArrivalTime({ bookingType: 'nightly', checkIn: offer.checkIn }, offer.property, new Date()),
        earlyArrivalAmount: earlyArrivalAmount(
          String(offer.plan.rate),
          String((await readRecord(ctx, 'company.Company', ctx.scope.company))?.currency ?? 'VND'),
        ),
        cancellationPolicyType: offer.terms.cancellationPolicyType ?? null,
        cancellationFeeRule: offer.terms.cancellationFeeRule ?? null,
        freeCancellationHours: offer.terms.freeCancellationHours ?? null,
        penaltyPercent: offer.terms.penaltyPercent ?? null,
      },
      errors: [],
    }
  } catch (error) {
    if (error instanceof CommandRejected) return error.result
    throw error
  }
}

const roomReads = ['read:hospitality_core.RoomAssignment', 'read:hospitality_core.RoomBlock']

export const deskBookingFunctions = {
  getDeskBookingContext: defineFn({
    input: { propertyId: 'id?' },
    output: { record: 'json?' },
    effects: ['read:hospitality_core.Property', 'read:company.Company'],
    handler: getDeskBookingContextHandler,
  }),
  searchDeskOffers: defineFn({
    input: { ...DESK_SEARCH_INPUT, ratePlanId: 'id?', page: 'int?' },
    output: {
      ok: 'bool',
      rows: 'json?',
      total: 'int?',
      pages: 'int?',
      page: 'int?',
      query: 'json?',
      errors: 'json?',
    },
    effects: [...reservationQuoteEffects, ...roomReads, 'read:hospitality_core.CancellationPolicy'],
    handler: searchDeskOffersHandler,
  }),
  getDeskBookingQuote: defineFn({
    input: { ...DESK_SEARCH_INPUT, ratePlanId: 'id' },
    output: { ok: 'bool', quote: 'json?', errors: 'json?' },
    effects: [...reservationQuoteEffects, 'read:hospitality_core.CancellationPolicy', 'read:company.Company'],
    handler: getDeskBookingQuoteHandler,
  }),
  lookupDeskRooms: defineFn({
    input: { ...DESK_SEARCH_INPUT, ratePlanId: 'id', id: 'id?', search: 'text?', limit: 'int?' },
    effects: [...reservationQuoteEffects, ...roomReads, 'read:hospitality_core.CancellationPolicy'],
    handler: lookupDeskRoomsHandler,
  }),
  lookupDeskGuests: defineFn({
    input: { id: 'id?', search: 'text?', limit: 'int?' },
    effects: ['read:partner.Partner'],
    handler: lookupDeskGuestsHandler,
  }),
}
