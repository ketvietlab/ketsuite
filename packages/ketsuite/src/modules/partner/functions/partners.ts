import { asc, defineFn, desc, eq, from, gt, like, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { sharedCache } from '../../../cache.ts'
import { phoneSearchFragments } from '../../../phone.ts'
import { PARTNER_KINDS } from '../types.ts'
import {
  type Issue,
  issue,
  invalid,
  changeIssues,
  COUNT_CACHE_TTL_MS,
  COUNT_CACHE_PREFIX,
  invalidatePartnerCountCache,
  normalizedEmail,
  normalizedPhone,
  presentationOf,
  parentIssue,
} from './helpers.ts'

export async function listPartnersHandler(ctx: Ctx, a: Row) {
  const P = ctx.table('partner.Partner')
  const sortColumn =
    a.sortField === 'email'
      ? P.email
      : a.sortField === 'phone'
        ? P.phone
        : a.sortField === 'ref'
          ? P.ref
          : a.sortField === 'kind'
            ? P.kind
            : P.name
  let q = from(P)
    .select(P.id, P.kind, P.name, P.ref, P.email, P.phone, P.contactConsent, P.active)
    .orderBy(a.sortDirection === 'desc' ? desc(sortColumn) : asc(sortColumn))
  const groupField = Array.isArray(a.groupBy) ? a.groupBy[0] : undefined
  const groupValue = Array.isArray(a.groupPath) ? a.groupPath[0] : undefined
  if (groupField === 'state' && groupValue !== undefined) {
    q = q.where(eq(P.active, groupValue === 'active'))
  } else if (a.includeArchived !== true) {
    q = q.where(eq(P.active, true))
  }
  if (a.kind) q = q.where(eq(P.kind, a.kind))
  else if (groupField === 'kind' && groupValue) q = q.where(eq(P.kind, String(groupValue)))
  if (a.search) {
    const search = String(a.search).normalize('NFKC').trim()
    const phones = phoneSearchFragments(search)
    q = q.where(
      or(
        like(P.name, `%${search}%`),
        like(P.email, `%${normalizedEmail(search) ?? search}%`),
        ...(phones.length ? phones : [search]).map((phone) => like(P.phone, `%${phone}%`)),
      ),
    )
  }
  if (Array.isArray(a.ids)) {
    if (!a.ids.length) return []
    q = q.where(inArray(P.id, a.ids.slice(0, 2_000).map(String)))
  }
  if (!a.role) {
    if (typeof a.limit === 'number') q = q.limit(a.limit)
    if (typeof a.offset === 'number') q = q.offset(a.offset)
    return ctx.db.all(q)
  }
  let rows = await ctx.db.all(q)
  if (a.role) {
    const R = ctx.table('partner.Role')
    const holders = new Set(
      (await ctx.db.all(from(R).select(R.partnerId).where(eq(R.role, a.role)))).map((row) => row.partnerId),
    )
    rows = rows.filter((row) => holders.has(row.id))
  }
  const offset = typeof a.offset === 'number' ? a.offset : 0
  const end = typeof a.limit === 'number' ? offset + a.limit : undefined
  return rows.slice(offset, end)
}

export async function countPartnersHandler(ctx: Ctx, a: Row) {
  const cache = sharedCache()
  const cacheKey =
    COUNT_CACHE_PREFIX +
    JSON.stringify([a.role ?? null, a.kind ?? null, a.search ?? null, a.includeArchived === true])
  const cached = await cache.get(cacheKey)
  if (cached !== null) return { count: Number(cached) }

  const P = ctx.table('partner.Partner')
  let q = from(P).select(P.id)
  if (a.includeArchived !== true) q = q.where(eq(P.active, true))
  if (a.kind) q = q.where(eq(P.kind, a.kind))
  if (a.search) q = q.where(like(P.name, `%${String(a.search)}%`))
  let count: number
  if (!a.role) {
    count = await ctx.db.count(q)
  } else {
    const rows = await ctx.db.all(q)
    const R = ctx.table('partner.Role')
    const holders = new Set(
      (await ctx.db.all(from(R).select(R.partnerId).where(eq(R.role, a.role)))).map((row) => row.partnerId),
    )
    count = rows.filter((row) => holders.has(row.id)).length
  }
  await cache.set(cacheKey, String(count), COUNT_CACHE_TTL_MS)
  return { count }
}

export async function getPartnerHandler(ctx: Ctx, a: Row) {
  const P = ctx.table('partner.Partner')
  const row = await ctx.db.one(from(P).where(eq(P.id, a.id)))
  if (!row) return null
  const A = ctx.table('partner.Address')
  const D = ctx.table('partner.AddressDefault')
  const R = ctx.table('partner.Role')
  const [addresses, defaults, roles] = await Promise.all([
    ctx.db.all(from(A).where(eq(A.partnerId, a.id))),
    ctx.db.all(from(D).select(D.addressId).where(eq(D.partnerId, a.id))),
    ctx.db.all(from(R).where(eq(R.partnerId, a.id))),
  ])
  const selected = new Set(defaults.map((item) => item.addressId))
  return {
    ...row,
    addresses: await Promise.all(
      addresses.map(async (address) => ({
        ...(await presentationOf(ctx, address)),
        isDefault: selected.has(address.id),
      })),
    ),
    roles,
  }
}

export async function savePartnerHandler(ctx: Ctx, a: Row) {
  const errors: Issue[] = []
  if (!PARTNER_KINDS.includes(String(a.kind) as never))
    errors.push(issue('kind', 'partner.error.kind', { allowed: PARTNER_KINDS }))
  if (!String(a.name).trim()) errors.push(issue('name', 'partner.error.required'))
  const hierarchy = await parentIssue(ctx, { id: a.id, kind: a.kind, parentId: a.parentId })
  if (hierarchy) errors.push(hierarchy)
  const P = ctx.table('partner.Partner')
  if (a.kind === 'person') {
    const companyChild = await ctx.db.one(from(P).where(eq(P.parentId, a.id), eq(P.kind, 'company')))
    if (companyChild) errors.push(issue('kind', 'partner.error.personCannotOwnCompany'))
  }
  if (errors.length) return invalid(errors)
  const existing = await ctx.db.one(from(P).where(eq(P.id, a.id)))
  const contactConsent =
    typeof a.contactConsent === 'boolean'
      ? a.contactConsent
      : typeof existing?.contactConsent === 'boolean'
        ? existing.contactConsent
        : Boolean(a.email || a.phone)
  let cs = ctx
    .change(
      'partner.Partner',
      {
        ...a,
        name: String(a.name).trim(),
        email: contactConsent ? normalizedEmail(a.email) : null,
        phone: contactConsent ? normalizedPhone(a.phone) : null,
        contactConsent,
      },
      existing,
    )
    .cast(['id', 'kind', 'name', 'parentId', 'vat', 'ref', 'email', 'phone', 'contactConsent', 'lang'])
  if (!existing) cs = cs.put('active', true)
  if (!cs.valid) return invalid(changeIssues(cs.errors))
  await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
  await invalidatePartnerCountCache()
  return { ok: true, id: a.id }
}

export async function normalizePartnerPhonesHandler(ctx: Ctx, a: Row) {
  const P = ctx.table('partner.Partner')
  const limit = Math.max(1, Math.min(5_000, Number(a.limit ?? 1_000)))
  let query = from(P).select(P.id, P.phone).orderBy(asc(P.id)).limit(limit)
  if (a.after) query = query.where(gt(P.id, String(a.after)))
  const rows = await ctx.db.all(query)
  let changed = 0
  for (const row of rows) {
    if (row.phone == null) continue
    const phone = normalizedPhone(row.phone)
    if (phone === row.phone) continue
    await ctx.db.update('partner.Partner', { id: row.id }, { phone })
    changed++
  }
  return {
    scanned: rows.length,
    changed,
    next: rows.length === limit ? String(rows.at(-1)!.id) : null,
  }
}

export async function archivePartnerHandler(ctx: Ctx, a: Row) {
  await ctx.db.update('partner.Partner', { id: a.id }, { active: a.active } as Row)
  await invalidatePartnerCountCache()
  return { id: a.id, active: a.active }
}

export async function archivePartnersHandler(ctx: Ctx, a: Row) {
  if (
    !Array.isArray(a.ids) ||
    !a.ids.length ||
    a.ids.length > 2_000 ||
    a.ids.some((id) => typeof id !== 'string' || !id.trim())
  )
    return invalid([issue('ids', 'partner.error.invalid')])
  const ids = [...new Set(a.ids.map((id) => id.trim()))]
  const P = ctx.table('partner.Partner')
  const rows = await ctx.db.all(from(P).select(P.id).where(inArray(P.id, ids)))
  for (const row of rows) await ctx.db.update('partner.Partner', { id: row.id }, { active: a.active } as Row)
  if (rows.length) await invalidatePartnerCountCache()
  return { ok: true, updated: rows.length }
}

export const partnersFunctions: Record<string, FnSpec> = {
  listPartners: defineFn({
    input: {
      role: 'text?',
      kind: 'text?',
      search: 'text?',
      // Exactly these partners, for screens that already know who they need.
      // A list of orders wants the names behind its five hundred partnerIds,
      // and loading every partner in the tenant to build that map does not
      // survive a customer base imported from a chat-commerce channel.
      ids: 'json?',
      includeArchived: 'bool?',
      // Optional, whitelisted client-side sort for `KetTable`'s manager — see
      // `packages/design-system/src/interactions/ket-table/index.tsx`. Omitted,
      // this keeps its long-standing default (name ascending) for every
      // existing caller, `relation-select`'s manager included.
      sortField: 'text?',
      sortDirection: 'text?',
      limit: 'int?',
      offset: 'int?',
      // `KetTable`'s manager appends these two when fetching a group's rows —
      // `groupBy: ['kind' | 'state']` naming which column, `groupPath: [value]`
      // naming which value of it. Only a single level is ever sent today (the
      // partner list groups by one field at a time), so only `[0]` is read.
      groupBy: 'json?',
      groupPath: 'json?',
    },
    output: {
      id: 'id',
      kind: 'text',
      name: 'text',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      contactConsent: 'bool?',
      active: 'bool',
    },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    agent: true,
    handler: listPartnersHandler,
  }),
  countPartners: defineFn({
    input: { role: 'text?', kind: 'text?', search: 'text?', includeArchived: 'bool?' },
    output: { count: 'int' },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    handler: countPartnersHandler,
  }),
  getPartner: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      contactConsent: 'bool?',
      lang: 'text?',
      active: 'bool',
      addresses: 'json?',
      roles: 'json?',
    },
    effects: [
      'read:partner.Partner',
      'read:partner.Address',
      'read:partner.AddressDefault',
      'read:partner.Role',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: getPartnerHandler,
  }),
  savePartner: defineFn({
    input: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      contactConsent: 'bool?',
      lang: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: savePartnerHandler,
  }),
  normalizePartnerPhones: defineFn({
    input: { after: 'text?', limit: 'int?' },
    output: { scanned: 'int', changed: 'int', next: 'text?' },
    effects: ['read:partner.Partner', 'write:partner.Partner'],
    idempotent: true,
    handler: normalizePartnerPhonesHandler,
  }),
  archivePartner: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: archivePartnerHandler,
  }),
  archivePartners: defineFn({
    input: { ids: 'json', active: 'bool' },
    output: { ok: 'bool', updated: 'int?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: archivePartnersHandler,
  }),
}
