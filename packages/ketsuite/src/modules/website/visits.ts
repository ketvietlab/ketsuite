import { createHash, randomUUID } from 'node:crypto'
import { asc, defineFn, defineJob, deleteFrom, from, inArray, isNotNull, lte } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, JobSpec, Row } from '@ketvietlab/ketjs'

/**
 * Visits of visitors who agreed to be tracked.
 *
 * A visitor who lands from an ad usually calls or messages the shop instead of checking out, so
 * the ad source cannot wait for an order: it is kept on the visit, with what the visitor looked
 * at and which contact link they pressed, until staff link the visit to the customer who called.
 * Nothing here is recorded unless the site asks for agreement and the visitor gave it to the
 * notice currently in force.
 */

/** Longest notice the site may show. A notice is read in a banner, not a policy page. */
export const VISIT_NOTICE_LIMIT = 2_000

/**
 * How long a visit is kept. Google accepts an offline conversion for 90 days after the click, and
 * a visit older than that can no longer be reported to anyone.
 */
export const VISIT_RETENTION_DAYS = 90

const RATE_WINDOW_MS = 10 * 60 * 1000
/** Pages and clicks of one visitor in ten minutes: generous for a person, tight for a script. */
const RATE_LIMIT = 120
const PURGE_BATCH = 500
const PASSES_PER_RUN = 8

const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid'] as const
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
export const CONTACT_CHANNELS = new Set(['phone', 'zalo', 'messenger', 'email'])
const VISITOR_KEY = /^[A-Za-z0-9_-]{22,64}$/
const CLICK_ID_VALUE = /^[A-Za-z0-9._~-]{1,512}$/

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })

/** What a public page needs to know about the site's consent notice; nothing when it is off. */
export const visitConsentOf = (
  site: Row,
): { visitConsent: boolean; visitConsentNotice: string | null; visitConsentVersion: number | null } =>
  site.visitConsent === true && site.visitConsentNotice && Number(site.visitConsentVersion) > 0
    ? {
        visitConsent: true,
        visitConsentNotice: String(site.visitConsentNotice),
        visitConsentVersion: Number(site.visitConsentVersion),
      }
    : { visitConsent: false, visitConsentNotice: null, visitConsentVersion: null }

/** A path without its query: the query carries the click ids, which are kept on the visit only. */
const cleanPath = (value: unknown): string | null => {
  const raw = String(value ?? '')
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2_048 || hasControlCharacter(raw))
    return null
  return raw.split(/[?#]/, 1)[0] || '/'
}

const cleanText = (value: unknown, limit: number): string | null => {
  const text = String(value ?? '').trim()
  if (!text || hasControlCharacter(text)) return null
  return text.slice(0, limit)
}

const pick = (params: unknown, keys: readonly string[], accept: (value: string) => string | null) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const picked: Record<string, string> = {}
  for (const key of keys) {
    const value = accept(String((params as Record<string, unknown>)[key] ?? '').trim())
    if (value) picked[key] = value
  }
  return Object.keys(picked).length ? picked : null
}

const clickIdsOf = (params: unknown) =>
  pick(params, CLICK_ID_KEYS, (value) => (CLICK_ID_VALUE.test(value) ? value : null))
const utmOf = (params: unknown) => pick(params, UTM_KEYS, (value) => cleanText(value, 200))

/** A contact target worth keeping: the dialled digits, or the host and path a chat link opened. */
const contactTarget = (channel: string, value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (channel === 'phone') {
    const digits = raw.replace(/[^0-9+]/g, '')
    return digits.length >= 3 && digits.length <= 20 ? digits : null
  }
  return cleanText(raw, 200)
}

/** The visitor key is a bearer secret of the browser; only its digest, bound to the site, is stored. */
const visitorDigest = (siteId: string, key: string): string =>
  createHash('sha256').update(`${siteId}\0${key}`).digest('hex')

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const claimRateSlot = async (ctx: Ctx, key: string, now: Date): Promise<boolean> => {
  const id = createHash('sha256').update(key).digest('hex').slice(0, 40)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const held = (await ctx.db.select('website.VisitRateLimit', { id }))[0]
    if (!held) {
      const inserted = await ctx.db.insertIfAbsent('website.VisitRateLimit', {
        id,
        key: id,
        windowStartedAt: now.toISOString(),
        count: 1,
      })
      if ('dryRun' in inserted || inserted.inserted) return true
      continue
    }
    const inWindow = now.getTime() - new Date(String(held.windowStartedAt)).getTime() < RATE_WINDOW_MS
    if (inWindow && Number(held.count) >= RATE_LIMIT) return false
    const changed = await ctx.db.compareAndSet(
      'website.VisitRateLimit',
      { id },
      { windowStartedAt: held.windowStartedAt, count: held.count },
      {
        windowStartedAt: inWindow ? held.windowStartedAt : now.toISOString(),
        count: inWindow ? Number(held.count) + 1 : 1,
      },
    )
    if ('dryRun' in changed || changed.matched) return true
  }
  return false
}

/** The site, if it is live and asks for the agreement this visitor says they gave. */
const consentingSite = async (ctx: Ctx, siteId: unknown, consentVersion: unknown) => {
  const site = (await ctx.db.select('website.Site', { id: siteId }))[0]
  const consent = site?.active === true ? visitConsentOf(site) : null
  if (!site || !consent?.visitConsent) return { error: invalid('siteId', 'website.error.visitTrackingOff') }
  // An agreement to an older wording is not an agreement to this one: the visitor is asked again.
  if (Number(consentVersion) !== consent.visitConsentVersion)
    return { error: invalid('consentVersion', 'website.error.visitConsentStale') }
  return { site, version: consent.visitConsentVersion }
}

const subjectOf = (args: Row) => {
  const type = cleanText(args.subjectType, 40)
  const id = type ? cleanText(args.subjectId, 120) : null
  return type && id ? { subjectType: type, subjectId: id } : { subjectType: null, subjectId: null }
}

export const visitFunctions: Record<string, FnSpec> = {
  recordVisit: defineFn({
    anonymous: true,
    input: {
      siteId: 'id',
      visitorKey: 'text',
      consentVersion: 'int',
      path: 'text',
      referrerHost: 'text?',
      params: 'json?',
      subjectType: 'text?',
      subjectId: 'text?',
      rateKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.VisitRateLimit',
      'write:website.VisitRateLimit',
      'write:website.Visit',
      'write:website.VisitEvent',
    ],
    exposure: 'internal',
    handler: async (ctx: Ctx, args) => {
      const checked = await consentingSite(ctx, args.siteId, args.consentVersion)
      if ('error' in checked) return checked.error
      const key = String(args.visitorKey ?? '')
      if (!VISITOR_KEY.test(key)) return invalid('visitorKey', 'website.error.invalidVisit')
      const path = cleanPath(args.path)
      if (!path) return invalid('path', 'website.error.invalidVisit')
      const now = new Date()
      if (
        !(await claimRateSlot(
          ctx,
          `${String(args.siteId)}:${String(args.rateKey ?? key).slice(0, 500)}`,
          now,
        ))
      )
        return invalid('visitorKey', 'website.error.visitRateLimit')
      const id = randomUUID()
      const referrerHost = cleanText(args.referrerHost, 253)
      await ctx.tx(async (tx) => {
        await tx.db.insert('website.Visit', {
          id,
          siteId: checked.site.id,
          visitorDigest: visitorDigest(String(checked.site.id), key),
          consentVersion: checked.version,
          clickIds: clickIdsOf(args.params),
          utm: utmOf(args.params),
          landingPath: path,
          referrerHost: referrerHost ? referrerHost.toLowerCase() : null,
          startedAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          expiresAt: addDays(now, VISIT_RETENTION_DAYS).toISOString(),
        })
        await tx.db.insert('website.VisitEvent', {
          id: randomUUID(),
          visitId: id,
          kind: 'page',
          path,
          ...subjectOf(args),
          channel: null,
          target: null,
          occurredAt: now.toISOString(),
        })
      })
      return { ok: true, id }
    },
  }),

  recordVisitEvent: defineFn({
    anonymous: true,
    input: {
      siteId: 'id',
      visitId: 'id',
      visitorKey: 'text',
      consentVersion: 'int',
      kind: 'text',
      path: 'text',
      subjectType: 'text?',
      subjectId: 'text?',
      channel: 'text?',
      target: 'text?',
      rateKey: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.Visit',
      'write:website.Visit',
      'read:website.VisitRateLimit',
      'write:website.VisitRateLimit',
      'write:website.VisitEvent',
    ],
    exposure: 'internal',
    handler: async (ctx: Ctx, args) => {
      const checked = await consentingSite(ctx, args.siteId, args.consentVersion)
      if ('error' in checked) return checked.error
      const key = String(args.visitorKey ?? '')
      const visit = VISITOR_KEY.test(key)
        ? (await ctx.db.select('website.Visit', { id: args.visitId }))[0]
        : null
      const now = new Date()
      // One answer for a visit that is missing, someone else's, or expired: the reply must not
      // tell a guesser which of those it hit.
      if (
        !visit ||
        visit.siteId !== checked.site.id ||
        visit.visitorDigest !== visitorDigest(String(checked.site.id), key) ||
        new Date(String(visit.expiresAt)) <= now
      )
        return invalid('visitId', 'website.error.invalidVisit')
      const kind = String(args.kind ?? '')
      const path = cleanPath(args.path)
      if (!path || (kind !== 'page' && kind !== 'contact'))
        return invalid('kind', 'website.error.invalidVisit')
      const channel = kind === 'contact' ? String(args.channel ?? '') : null
      if (channel !== null && !CONTACT_CHANNELS.has(channel))
        return invalid('channel', 'website.error.invalidVisit')
      if (
        !(await claimRateSlot(
          ctx,
          `${String(args.siteId)}:${String(args.rateKey ?? key).slice(0, 500)}`,
          now,
        ))
      )
        return invalid('visitorKey', 'website.error.visitRateLimit')
      const id = randomUUID()
      await ctx.tx(async (tx) => {
        await tx.db.insert('website.VisitEvent', {
          id,
          visitId: visit.id,
          kind,
          path,
          ...subjectOf(args),
          channel,
          target: channel ? contactTarget(channel, args.target) : null,
          occurredAt: now.toISOString(),
        })
        await tx.db.update('website.Visit', { id: visit.id }, { lastSeenAt: now.toISOString() })
      })
      return { ok: true, id }
    },
  }),
}

const dayStamp = (now: Date): string => now.toISOString().slice(0, 10)

/**
 * Retention runs on its own: a period nobody enforces is a sentence in a notice, not a property of
 * the system. Sites that have ever asked for agreement name the companies to sweep.
 */
export const visitJobs: Record<string, JobSpec> = {
  visitRetentionSweep: defineJob({
    input: {},
    idempotent: true,
    crossCompany: true,
    schedule: { every: '24h' },
    effects: ['read:website.Site', 'enqueue:website.purgeExpiredVisits'],
    handler: async (ctx) => {
      const Site = ctx.table('website.Site')
      const sites = await ctx.db.all(
        from(Site).where(isNotNull(Site.visitConsentVersion)).orderBy(asc(Site.id)),
      )
      const companies = new Set<string>()
      for (const site of sites) if (site.companyId != null) companies.add(String(site.companyId))
      const now = new Date()
      for (const company of [...companies].sort())
        await ctx.jobs.enqueue(
          'website.purgeExpiredVisits',
          { pass: 1 },
          { company, uniqueKey: `website.visitRetention:${company}:${dayStamp(now)}:1` },
        )
    },
  }),

  purgeExpiredVisits: defineJob({
    input: { pass: 'int?' },
    idempotent: true,
    effects: [
      'read:website.Visit',
      'write:website.Visit',
      'write:website.VisitEvent',
      'enqueue:website.purgeExpiredVisits',
    ],
    handler: async (ctx, args) => {
      const now = new Date()
      const pass = Number.isInteger(Number(args.pass)) ? Math.max(Number(args.pass), 1) : 1
      const Visit = ctx.table('website.Visit')
      const Event = ctx.table('website.VisitEvent')
      for (let round = 0; round < PASSES_PER_RUN; round += 1) {
        const due = await ctx.db.all(
          from(Visit)
            .where(lte(Visit.expiresAt, now.toISOString()))
            .select(Visit.id)
            .orderBy(asc(Visit.expiresAt))
            .limit(PURGE_BATCH + 1),
        )
        const ids = due.slice(0, PURGE_BATCH).map((row) => String(row.id))
        if (!ids.length) return
        // Events first: a visit is never gone while something still points at it.
        await ctx.db.del(deleteFrom(Event).where(inArray(Event.visitId, ids)))
        await ctx.db.del(deleteFrom(Visit).where(inArray(Visit.id, ids)))
        if (due.length <= PURGE_BATCH) return
      }
      // More than one run's worth: hand the rest to a fresh job under its own key, so it is not
      // swallowed by this run's still-held key.
      await ctx.jobs.enqueue(
        'website.purgeExpiredVisits',
        { pass: pass + 1 },
        { uniqueKey: `website.visitRetention:${ctx.scope.company ?? ''}:${dayStamp(now)}:${pass + 1}` },
      )
    },
  }),
}
