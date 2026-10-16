import { eq, from } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { sharedCache } from '../../../cache.ts'
import { phoneKey } from '../../../phone.ts'
import { resolveAddress, snapshotAddress } from '../../address/format.ts'

export type Issue = { field: string; code: string; params?: Record<string, unknown> }

export const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})

export const invalid = (errors: Issue[]) => ({ ok: false, errors })

export class DefaultConflict extends Error {}

export const changeIssues = (errors: Array<{ field: string }>): Issue[] =>
  errors.map((error) => issue(error.field, 'partner.error.invalid'))

/**
 * `countPartners`'s filtered COUNT gets expensive well before a million rows
 * (measured ~80-110ms there, and the partner list screen alone fires five of
 * these — one per summary tab plus the current filter — on every page load).
 * A count that stale-for-an-hour is fine for a partner directory, so cache
 * it here rather than recomputing on every request.
 *
 * Goes through `sharedCache()` — Redis when `REDIS_URL` is set, so every
 * process/pod sees the same cache and the same invalidation, an in-process
 * Map otherwise. See `../../cache.ts`.
 */
export const COUNT_CACHE_TTL_MS = 60 * 60 * 1000

export const COUNT_CACHE_PREFIX = 'partner:count:'

/**
 * Every write that could change any cached count's answer — a partner's
 * kind/active state, or its role membership — clears the whole namespace
 * rather than trying to work out which of the cached filter combinations it
 * affects. Writes are rare next to reads here, so this keeps the cache
 * exactly as fresh as "no cache" between them, while the TTL above is only
 * the fallback for whatever this list misses.
 */
export const invalidatePartnerCountCache = (): Promise<void> => sharedCache().clear(COUNT_CACHE_PREFIX)

export type AddressArgs = Record<string, unknown>

export const normalizedEmail = (value: unknown): string | null => {
  const email = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
  return email || null
}

/** Stored in E.164 so `0708…`, `84708…` and `+84 708…` are one customer. */
export const normalizedPhone = (value: unknown): string | null => phoneKey(value)

export const canonicalAddress = (args: AddressArgs) => ({
  street1: String(args.street1 ?? args.street ?? '').trim(),
  street2: args.street2 ? String(args.street2).trim() : null,
  locality: args.locality || args.city ? String(args.locality ?? args.city).trim() : null,
  postalCode: args.postalCode || args.zip ? String(args.postalCode ?? args.zip).trim() : null,
  countryCode: String(args.countryId ?? args.countryCode ?? args.country ?? '')
    .trim()
    .toUpperCase(),
  divisionId: args.divisionId ? String(args.divisionId) : null,
  divisionText: args.divisionText || args.state ? String(args.divisionText ?? args.state).trim() : null,
})

export const presentationOf = async (ctx: Ctx, row: Row): Promise<Row> => {
  const canonical = {
    id: row.id,
    street1: row.street1,
    street2: row.street2,
    locality: row.locality,
    postalCode: row.postalCode,
    countryId: row.countryId,
    divisionId: row.divisionId,
  }
  let oneLine = [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode]
    .filter(Boolean)
    .join(', ')
  let divisionPath: Row[] = []
  if (row.countryId) {
    const resolved = await resolveAddress(ctx, canonical)
    if (resolved.value) {
      oneLine = resolved.value.oneLine
      divisionPath = resolved.value.divisions
    }
  }
  return {
    ...row,
    oneLine,
    divisionPath,
    // Compatibility projection for callers created before canonical address refs.
    street: row.street1,
    city: divisionPath.at(-1)?.officialName ?? row.locality ?? '',
    zip: row.postalCode,
    state: divisionPath.at(-2)?.officialName ?? row.divisionText,
    country: row.countryCode,
  }
}

export const defaultAddressFor = async (ctx: Ctx, partnerId: string, use: string): Promise<Row | null> => {
  const D = ctx.table('partner.AddressDefault')
  const selected = await ctx.db.one(from(D).where(eq(D.partnerId, partnerId), eq(D.use, use)))
  if (!selected) return null
  const A = ctx.table('partner.Address')
  return ctx.db.one(from(A).where(eq(A.id, selected.addressId)))
}

export const snapshotPartnerAddress = async (
  ctx: Ctx,
  addressId: string | null | undefined,
  capturedAt = new Date().toISOString(),
): Promise<Record<string, unknown> | null> => {
  if (!addressId) return null
  const A = ctx.table('partner.Address')
  const row = await ctx.db.one(from(A).where(eq(A.id, addressId)))
  if (!row) return null
  if (row.countryId) {
    const result = await snapshotAddress(
      ctx,
      {
        id: row.id,
        street1: row.street1,
        street2: row.street2,
        locality: row.locality,
        postalCode: row.postalCode,
        countryId: row.countryId,
        divisionId: row.divisionId,
      },
      capturedAt,
    )
    if (result.snapshot) return result.snapshot
  }
  const fallback = await presentationOf(ctx, row)
  return {
    schemaVersion: 1,
    sourceAddressId: row.id,
    capturedAt,
    catalogId: null,
    country: { id: null, code: row.countryCode, name: row.countryCode },
    divisions: [],
    street1: row.street1,
    street2: row.street2 ?? null,
    locality: row.locality ?? null,
    postalCode: row.postalCode ?? null,
    lines: [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode].filter(
      Boolean,
    ),
    oneLine: fallback.oneLine,
  }
}

export const parentIssue = async (
  ctx: Ctx,
  candidate: { id: unknown; kind: unknown; parentId?: unknown },
): Promise<Issue | null> => {
  if (!candidate.parentId) return null
  const P = ctx.table('partner.Partner')
  const id = String(candidate.id)
  const seen = new Set<string>()
  let current = String(candidate.parentId)
  let first = true
  while (current) {
    if (current === id || seen.has(current)) return issue('parentId', 'partner.error.parentCycle')
    seen.add(current)
    const row = await ctx.db.one(from(P).where(eq(P.id, current)))
    if (!row) return issue('parentId', 'partner.error.parentMissing')
    if (first && candidate.kind === 'company' && row.kind === 'person')
      return issue('parentId', 'partner.error.personCannotOwnCompany')
    first = false
    current = row.parentId ? String(row.parentId) : ''
  }
  return null
}

/** Keep one default mapping under concurrent writers. The deterministic id and
 * unique index make the row singular; the final atomic update chooses the winner. */
export const selectDefault = async (
  ctx: Ctx,
  partnerId: string,
  use: string,
  addressId: string,
): Promise<boolean> => {
  const id = `default:${partnerId}:${use}`
  const changed = await ctx.db.update('partner.AddressDefault', { id }, { addressId })
  if ('dryRun' in changed || changed.changes > 0) return true
  const inserted = await ctx.db.insertIfAbsent('partner.AddressDefault', {
    id,
    partnerId,
    use,
    addressId,
  })
  if ('dryRun' in inserted || inserted.inserted) return true
  const retried = await ctx.db.update('partner.AddressDefault', { id }, { addressId })
  if ('dryRun' in retried || retried.changes > 0) return true
  return false
}
