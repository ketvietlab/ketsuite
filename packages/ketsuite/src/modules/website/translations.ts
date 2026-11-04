import { randomUUID } from 'node:crypto'
import { asc, defineFn, eq, from, gt, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, JobContext, JobSpec, Placement, Row } from '@ketvietlab/ketjs'
import { canAccessSite, canCreateEntry, canEditEntry } from './access.ts'

/**
 * Translations: each language is its own entry, published on its own, with its own path and
 * slug. The entries of one piece of content share `translationGroupId`; there is no group table.
 */

export const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** A site's languages in order, the default always first among them even when not stored. */
export function siteLocales(site: Row | null | undefined): string[] {
  const fallback = String(site?.defaultLocale ?? 'vi')
  const stored = Array.isArray(site?.locales) ? (site!.locales as unknown[]).map(String) : []
  return stored.includes(fallback) ? stored : [fallback, ...stored]
}

/** Rows saved before translations carry no language; they are in the site's default. */
export const entryLocale = (entry: Row, site: Row | null | undefined): string =>
  String(entry.locale ?? site?.defaultLocale ?? 'vi')

export const entryGroup = (entry: Row): string => String(entry.translationGroupId ?? entry.id)

/**
 * The same page in another language: the default language has no prefix (`/khuyen-mai`), every
 * other one does (`/en/khuyen-mai`, home `/en`). The slug stays; editors change it afterwards.
 */
export function localizedPath(path: string, from: string, to: string, defaultLocale: string): string {
  let base = path
  if (from !== defaultLocale && (base === `/${from}` || base.startsWith(`/${from}/`)))
    base = base.slice(from.length + 1) || '/'
  if (to === defaultLocale) return base
  return base === '/' ? `/${to}` : `/${to}${base}`
}

/** Validates a site's language list and fallback order; `null` when either is malformed. */
export function siteLocaleSettings(
  defaultLocale: string,
  locales: unknown,
  fallback: unknown,
): { locales: string[]; localeFallback: string[] } | null {
  const list = locales == null ? [defaultLocale] : locales
  if (!Array.isArray(list) || list.length > 20 || list.some((l) => typeof l !== 'string' || !LOCALE.test(l)))
    return null
  const ordered = [...new Set(list as string[])]
  if (ordered.length !== list.length) return null
  if (!ordered.includes(defaultLocale)) ordered.unshift(defaultLocale)
  const order = fallback == null ? [] : fallback
  if (
    !Array.isArray(order) ||
    order.some((l) => typeof l !== 'string' || !ordered.includes(l)) ||
    new Set(order).size !== order.length
  )
    return null
  return { locales: ordered, localeFallback: order as string[] }
}

/** The other entries sharing an entry's group, the entry itself included. */
export async function translationsOf(ctx: Ctx, entry: Row): Promise<Row[]> {
  const Entry = ctx.table('website.Entry')
  const group = entryGroup(entry)
  // A row saved before translations is its own group without saying so: its id is the group's.
  const rows = (
    await ctx.db.all(
      from(Entry).where(
        eq(Entry.siteId, entry.siteId),
        or(eq(Entry.translationGroupId, group), eq(Entry.id, group)),
      ),
    )
  ).filter((row) => entryGroup(row) === group)
  return rows.some((row) => row.id === entry.id) ? rows : [entry, ...rows]
}

/** Text an editor writes in a section; `structure` copies leave these empty to be translated. */
const TEXT_SETTINGS = new Set(['heading', 'subheading', 'body', 'bodyDoc', 'caption', 'ctaLabel', 'alt'])
const TEXT_FIELDS = new Set(['bodyDoc', 'bodyText', 'excerpt'])

function withoutText(nodes: Placement[]): Placement[] {
  return nodes.map((node) => ({
    ...node,
    settings: Object.fromEntries(
      Object.entries(node.settings ?? {}).map(([key, value]) => [key, TEXT_SETTINGS.has(key) ? '' : value]),
    ),
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([slot, children]) => [slot, withoutText(children)]),
          ),
        }
      : {}),
  }))
}

const fail = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

/**
 * Lets `website.saveEntry` place a new entry in an existing group. Only `createTranslation` sets
 * it, for the one call it makes, so no caller can put an entry into another's group by input.
 */
export const translationGroupFor = new WeakMap<Ctx, string>()

const readEffects = ['read:website.Site', 'read:website.SiteMember', 'read:website.Entry']

export function translationFunctions(saveEntry: FnSpec): Record<string, FnSpec> {
  return {
    createTranslation: defineFn({
      input: { id: 'id', locale: 'text', copy: 'text?', newId: 'id?' },
      output: {
        ok: 'bool',
        id: 'id?',
        locale: 'text?',
        translationGroupId: 'text?',
        path: 'text?',
        status: 'text?',
        revisionId: 'id?',
        errors: 'json?',
      },
      effects: [...new Set([...readEffects, 'read:website.EntryRevision', ...(saveEntry.effects ?? [])])],
      idempotent: true,
      handler: async (ctx: Ctx, args) => {
        const source = (await ctx.db.select('website.Entry', { id: args.id }))[0]
        if (!source || source.status === 'trash' || !(await canAccessSite(ctx, source.siteId)))
          return fail('id', 'website.error.entryNotFound')
        if (!(await canCreateEntry(ctx, source.siteId))) return fail('siteId', 'website.error.forbidden')
        const site = (await ctx.db.select('website.Site', { id: source.siteId }))[0]!
        const locale = String(args.locale ?? '')
        if (!siteLocales(site).includes(locale)) return fail('locale', 'website.error.localeNotOnSite')
        const copy = args.copy ?? 'all'
        if (!['all', 'structure'].includes(String(copy))) return fail('copy', 'website.error.invalidCopy')
        const group = await translationsOf(ctx, source)
        const id = String(args.newId ?? randomUUID())
        const taken = group.find((row) => entryLocale(row, site) === locale)
        // A retried request finds the translation it already made.
        if (taken && taken.id === id)
          return {
            ok: true,
            id,
            locale,
            translationGroupId: entryGroup(source),
            path: taken.path,
            status: taken.status,
            revisionId: taken.currentRevisionId,
          }
        if (taken) return fail('locale', 'website.error.translationExists')
        const revision = (await ctx.db.select('website.EntryRevision', { id: source.currentRevisionId }))[0]
        const layout = (Array.isArray(revision?.layout) ? revision!.layout : []) as Placement[]
        const fields = { ...((revision?.fields ?? {}) as Row) }
        if (copy === 'structure') for (const key of TEXT_FIELDS) delete fields[key]
        const path = localizedPath(
          String(source.path),
          entryLocale(source, site),
          locale,
          String(site.defaultLocale),
        )
        // A source saved before translations names its group and language, so both see each other.
        if (!source.translationGroupId || !source.locale)
          await ctx.db.compareAndSet(
            'website.Entry',
            { id: source.id },
            { translationGroupId: source.translationGroupId ?? null, locale: source.locale ?? null },
            { translationGroupId: entryGroup(source), locale: entryLocale(source, site) },
          )
        translationGroupFor.set(ctx, entryGroup(source))
        let saved: Row
        try {
          saved = (await saveEntry.handler(ctx, {
            id,
            siteId: source.siteId,
            type: source.type,
            slug: source.slug,
            path,
            title: revision?.title ?? source.title,
            excerpt: copy === 'structure' ? null : (revision?.excerpt ?? source.excerpt ?? null),
            layout: copy === 'structure' ? withoutText(layout) : layout,
            fields: { ...fields, locale },
            locale,
            expectedRevisionId: null,
          })) as Row
        } finally {
          translationGroupFor.delete(ctx)
        }
        if (!saved.ok) return saved
        return {
          ok: true,
          id,
          locale,
          translationGroupId: entryGroup(source),
          path,
          status: 'draft',
          revisionId: saved.revisionId,
        }
      },
    }),

    linkTranslation: defineFn({
      input: { id: 'id', targetId: 'id' },
      output: { ok: 'bool', translationGroupId: 'text?', errors: 'json?' },
      effects: [...readEffects, 'write:website.Entry'],
      idempotent: true,
      handler: async (ctx: Ctx, args) => {
        const [source, target] = await Promise.all(
          [args.id, args.targetId].map(async (id) => (await ctx.db.select('website.Entry', { id }))[0]),
        )
        if (!source || !target || source.id === target.id)
          return fail('targetId', 'website.error.entryNotFound')
        if (!(await canEditEntry(ctx, source)) || !(await canEditEntry(ctx, target)))
          return fail('siteId', 'website.error.forbidden')
        if (source.siteId !== target.siteId || source.type !== target.type)
          return fail('targetId', 'website.error.translationMismatch')
        const site = (await ctx.db.select('website.Site', { id: source.siteId }))[0]
        const group = entryGroup(source)
        if (entryGroup(target) === group) return { ok: true, translationGroupId: group }
        // Joining one group means leaving the other; an entry already translated is unlinked first.
        if ((await translationsOf(ctx, target)).length > 1)
          return fail('targetId', 'website.error.translationLinked')
        const locale = entryLocale(target, site)
        if ((await translationsOf(ctx, source)).some((row) => entryLocale(row, site) === locale))
          return fail('targetId', 'website.error.translationExists')
        await ctx.tx(async (tx) => {
          // A row saved before translations gets its group named, so the link is visible both ways.
          if (!source.translationGroupId)
            await tx.db.compareAndSet(
              'website.Entry',
              { id: source.id },
              { translationGroupId: null },
              { translationGroupId: group, locale: entryLocale(source, site) },
            )
          const changed = await tx.db.compareAndSet(
            'website.Entry',
            { id: target.id },
            { translationGroupId: target.translationGroupId ?? null },
            { translationGroupId: group, locale },
          )
          if (!('dryRun' in changed) && !changed.matched) throw new Error('translation link raced')
        })
        return { ok: true, translationGroupId: group }
      },
    }),

    unlinkTranslation: defineFn({
      input: { id: 'id' },
      output: { ok: 'bool', translationGroupId: 'text?', errors: 'json?' },
      effects: [...readEffects, 'write:website.Entry'],
      idempotent: true,
      handler: async (ctx: Ctx, args) => {
        const entry = (await ctx.db.select('website.Entry', { id: args.id }))[0]
        if (!entry) return fail('id', 'website.error.entryNotFound')
        if (!(await canEditEntry(ctx, entry))) return fail('siteId', 'website.error.forbidden')
        if ((await translationsOf(ctx, entry)).length < 2)
          return { ok: true, translationGroupId: entryGroup(entry) }
        // The others keep the group's id, which may be this entry's own; this one leaves with a new one.
        const own = randomUUID()
        const changed = await ctx.db.compareAndSet(
          'website.Entry',
          { id: entry.id },
          { translationGroupId: entry.translationGroupId ?? null },
          { translationGroupId: own },
        )
        if (!('dryRun' in changed) && !changed.matched) return fail('id', 'website.error.editConflict')
        return { ok: true, translationGroupId: own }
      },
    }),

    listTranslations: defineFn({
      input: { id: 'id' },
      output: {
        id: 'id',
        locale: 'text',
        title: 'text',
        path: 'text',
        status: 'text',
        published: 'bool',
      },
      effects: readEffects,
      handler: async (ctx: Ctx, args) => {
        const entry = (await ctx.db.select('website.Entry', { id: args.id }))[0]
        if (!entry || !(await canAccessSite(ctx, entry.siteId))) return []
        const site = (await ctx.db.select('website.Site', { id: entry.siteId }))[0]
        const order = siteLocales(site)
        return (await translationsOf(ctx, entry))
          .filter((row) => row.status !== 'trash')
          .map((row) => ({
            id: row.id,
            locale: entryLocale(row, site),
            title: row.title,
            path: row.path,
            status: row.status,
            published: !!row.publishedRevisionId,
          }))
          .sort((a, b) => order.indexOf(a.locale) - order.indexOf(b.locale))
      },
    }),
  }
}

/**
 * Gives entries saved before translations their language and group: the language from the current
 * revision's `fields.locale`, else the site's default; each entry its own group. Operator-owned:
 * enqueue `website.migrateEntryLocales` once per database, with `{ dryRun: true }` first to see the
 * count in the job log. Nothing schedules it and no request runs it. Rows already set are skipped,
 * so a rerun after a failure resumes where it stopped.
 */
export async function migrateEntryLocales(
  ctx: JobContext,
  { dryRun = false, limit = 200 }: { dryRun?: boolean; limit?: number } = {},
): Promise<{ scanned: number; updated: number }> {
  const Entry = ctx.table('website.Entry')
  const sites = new Map<string, Row | undefined>()
  let after = ''
  let scanned = 0
  let updated = 0
  for (;;) {
    let query = from(Entry).orderBy(asc(Entry.id)).limit(limit)
    if (after) query = query.where(gt(Entry.id, after))
    const rows = await ctx.db.all(query)
    for (const entry of rows) {
      if (ctx.signal.aborted) throw ctx.signal.reason
      scanned += 1
      if (entry.locale && entry.translationGroupId) continue
      const siteId = String(entry.siteId)
      if (!sites.has(siteId)) sites.set(siteId, (await ctx.db.select('website.Site', { id: siteId }))[0])
      const revision = entry.currentRevisionId
        ? (await ctx.db.select('website.EntryRevision', { id: entry.currentRevisionId }))[0]
        : null
      const stored = String(((revision?.fields ?? {}) as Row).locale ?? '')
      const locale =
        entry.locale ?? (LOCALE.test(stored) ? stored : String(sites.get(siteId)?.defaultLocale ?? 'vi'))
      updated += 1
      if (dryRun) continue
      await ctx.db.compareAndSet(
        'website.Entry',
        { id: entry.id },
        { locale: entry.locale ?? null, translationGroupId: entry.translationGroupId ?? null },
        { locale, translationGroupId: entry.translationGroupId ?? entry.id },
      )
    }
    if (rows.length < limit) break
    after = String(rows.at(-1)!.id)
  }
  ctx.log.info('website.migrateEntryLocales', { dryRun, scanned, updated })
  return { scanned, updated }
}

export const translationJobs: Record<string, JobSpec> = {
  migrateEntryLocales: {
    queue: 'default',
    crossCompany: true,
    idempotent: true,
    maxAttempts: 3,
    effects: ['read:website.Site', 'read:website.Entry', 'read:website.EntryRevision', 'write:website.Entry'],
    handler: async (ctx: JobContext, args) => {
      await migrateEntryLocales(ctx, { dryRun: args.dryRun === true })
    },
  },
}
