import { randomUUID } from 'node:crypto'
import { and, asc, deleteFrom, eq, from, isNull, or } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export const isCatalogueSearch = (key: unknown) =>
  ['product.templates', 'product.variants'].includes(String(key))
/** Legacy private searches have no company marker. Only their owner may continue using them. */
export const visibleSearchWhere = (ctx: Ctx, listKey: string) => {
  const S = ctx.table('backend.SavedSearch')
  return and(
    eq(S.listKey!, listKey),
    eq(S.active!, true),
    or(
      and(
        eq(S.ownerId!, ctx.actor ?? ''),
        or(eq(S.companyId!, ctx.scope.company ?? ''), isNull(S.companyId!)),
      ),
      and(eq(S.shared!, true), eq(S.companyId!, ctx.scope.company ?? '')),
    ),
  )
}
export async function readVisibleSearches(ctx: Ctx, listKey: string) {
  if (!ctx.actor) return []
  const S = ctx.table('backend.SavedSearch')
  return ctx.db.all(from(S).where(visibleSearchWhere(ctx, listKey)).orderBy(asc(S.name!)))
}
export async function readVisibleSearch(ctx: Ctx, id: unknown, listKey: string) {
  return (await readVisibleSearches(ctx, listKey)).find((row) => row.id === id) ?? null
}
const fail = (field: string, reason: string) => ({
  ok: false as const,
  errors: [{ field, code: `backend.error.savedSearch.${reason}` }],
})
class SearchConflict extends Error {}
const sameCompany = (ctx: Ctx, row: Row) =>
  row.companyId == null || row.companyId === (ctx.scope.company ?? '')

/** Domain callers validate and canonicalize state before entering this shared owner/CAS writer. */
export async function saveOwnedSearch(ctx: Ctx, args: Row) {
  if (!ctx.actor) return fail('name', 'owner')
  const name = String(args.name ?? '').trim(),
    listKey = String(args.listKey ?? '')
  if (!name || (isCatalogueSearch(listKey) && [...name].length > 60)) return fail('name', 'name')
  if (
    !listKey ||
    !args.state ||
    typeof args.state !== 'object' ||
    Array.isArray(args.state) ||
    JSON.stringify(args.state).length > 20000
  )
    return fail('name', 'state')
  const fold = (value: unknown) =>
    isCatalogueSearch(listKey) ? String(value).normalize('NFC').toLocaleLowerCase('und') : String(value)
  const nameKey = fold(name)
  const state =
    listKey === 'product.templates'
      ? Object.fromEntries(
          ['q', 'presets', 'filters', 'groupBy', 'sort', 'includeArchived']
            .filter((key) => key in (args.state as Row))
            .map((key) => [key, (args.state as Row)[key]]),
        )
      : args.state
  try {
    return await ctx.tx(async (tx) => {
      const current = (await tx.db.select('backend.SavedSearch', { id: args.id }))[0]
      if (
        current &&
        (current.ownerId !== ctx.actor ||
          current.listKey !== listKey ||
          !sameCompany(ctx, current) ||
          current.active === false)
      )
        return fail('name', 'owner')
      if (
        current &&
        args.expectedRevisionId != null &&
        args.expectedRevisionId !== (current.revisionId ?? 'initial')
      )
        return fail('name', 'conflict')
      const siblings = await tx.db.select('backend.SavedSearch', {
        ownerId: ctx.actor,
        listKey,
        active: true,
      })
      if (siblings.some((row) => row.id !== args.id && fold(row.name) === nameKey))
        return fail('name', 'duplicate')
      if (args.default === true)
        for (const sibling of siblings)
          if (sibling.id !== args.id && sibling.defaultKey)
            await tx.db.update(
              'backend.SavedSearch',
              { id: sibling.id, ownerId: ctx.actor },
              { defaultKey: null },
            )
      const row = {
        ownerId: ctx.actor,
        listKey,
        name,
        nameKey,
        state,
        shared: args.shared == null ? current?.shared === true : args.shared === true,
        companyId: current?.companyId ?? ctx.scope.company ?? '',
        revisionId: randomUUID(),
        active: true,
        defaultKey:
          args.default == null
            ? (current?.defaultKey ?? null)
            : args.default === true
              ? `${ctx.actor}:${listKey}`
              : null,
      }
      if (current) {
        const updated = await tx.db.compareAndSet(
          'backend.SavedSearch',
          { id: args.id, ownerId: ctx.actor },
          { revisionId: current.revisionId ?? null },
          row,
        )
        if (!('dryRun' in updated) && !updated.matched) throw new SearchConflict()
      } else await tx.db.insert('backend.SavedSearch', { id: args.id, ...row })
      return { ok: true as const, id: args.id }
    })
  } catch (error) {
    if (error instanceof SearchConflict) return fail('name', 'conflict')
    const code = String((error as { code?: unknown }).code ?? ''),
      message = String((error as Error).message ?? '')
    if (code === '23505' || /unique|duplicate/i.test(message)) return fail('name', 'duplicate')
    throw error
  }
}
export async function removeOwnedSearch(ctx: Ctx, args: Row) {
  if (!ctx.actor) return fail('name', 'owner')
  return ctx.tx(async (tx) => {
    const row = (
      await tx.db.select('backend.SavedSearch', { id: args.id, ownerId: ctx.actor, listKey: args.listKey })
    )[0]
    if (!row || !sameCompany(ctx, row)) return fail('name', 'owner')
    if (row.active === false) return { ok: true as const }
    if (args.expectedRevisionId != null && args.expectedRevisionId !== (row.revisionId ?? 'initial'))
      return fail('name', 'conflict')
    const updated = await tx.db.compareAndSet(
      'backend.SavedSearch',
      { id: args.id, ownerId: ctx.actor },
      { revisionId: row.revisionId ?? null },
      { active: false, shared: false, nameKey: null, defaultKey: null, revisionId: randomUUID() },
    )
    if (!('dryRun' in updated) && !updated.matched) return fail('name', 'conflict')
    const S = tx.table('backend.SavedSearch')
    await tx.db.del(deleteFrom(S).where(eq(S.id!, args.id), eq(S.ownerId!, ctx.actor)))
    return { ok: true as const }
  })
}
