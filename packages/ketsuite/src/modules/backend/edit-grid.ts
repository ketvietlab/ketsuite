import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { KetGridIslandConfig, KetGridPosted, KetGridRow } from '@ketvietlab/design-system'

type Req = Parameters<Route>[1]

/**
 * A `KetGrid` for a server-rendered form, as a field's `control`. Name the grid
 * (`config.name`) after the form field; the grid posts its changes under that
 * name and the route reads them back with `postedGridRows`.
 */
export const editGridControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: KetGridIslandConfig & { name: string },
): Promise<JSXChild> => ctx.joint(url, req, 'backend:edit.grid', { id, config })

/**
 * The rows a grid that started empty posted, in the order shown: its added rows, then any
 * reordering. Null when the value is not a grid's posted changes, so a route can refuse it.
 */
export const postedGridRows = (value: string | undefined): KetGridRow[] | null => {
  let posted: Partial<KetGridPosted>
  try {
    posted = JSON.parse(value ?? '') as Partial<KetGridPosted>
  } catch {
    return null
  }
  if (!posted || typeof posted !== 'object' || !Array.isArray(posted.added)) return null
  const added = [...posted.added].sort((a, b) => a.index - b.index)
  const removed = new Set(Array.isArray(posted.removed) ? posted.removed : [])
  const kept = added.filter((row) => !removed.has(row.id))
  const order = Array.isArray(posted.order) ? posted.order : null
  if (order) kept.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  return kept.map((row) => ({ ...row.values }))
}
