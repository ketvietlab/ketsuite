import { isDeepStrictEqual } from 'node:util'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { readVisibleSearches } from '../../backend/saved-search-policy.ts'
import type { SavedFilter } from './state.ts'
export async function savedFilters(
  ctx: Ctx,
  listKey: string,
  current: unknown,
  canonical: (state: Row) => unknown,
  href: (row: Row) => string,
): Promise<SavedFilter[]> {
  const rows = await readVisibleSearches(ctx, listKey)
  return rows.flatMap((row) => {
    try {
      const state = canonical(row.state as Row)
      return [
        {
          id: String(row.id),
          name: String(row.name),
          owned: row.ownerId === ctx.actor,
          shared: row.shared === true,
          revisionId: String(row.revisionId ?? 'initial'),
          href: href(row),
          active: isDeepStrictEqual(state, current),
          isDefault: row.ownerId === ctx.actor && Boolean(row.defaultKey),
        },
      ]
    } catch {
      return []
    }
  })
}
