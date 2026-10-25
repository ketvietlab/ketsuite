import { and, asc, eq, gt, isNull, not, inArray, or } from '@ketvietlab/ketjs'
import type { Ctx, Query, Row, Table } from '@ketvietlab/ketjs'
import { refuse, string } from './policy.ts'

const priorities = ['urgent', 'high', 'normal']
const rank = (p: unknown) => {
  const i = priorities.indexOf(string(p))
  return i < 0 ? 3 : i
}
export type TaskPosition = {
  sequence: number
  id: string
  fence: string
  due: string | null
  priority: string
}
export const taskSort = (value: unknown) => {
  const sort = value === undefined ? 'manual' : string(value)
  if (!['manual', 'due', 'priority'].includes(sort)) return refuse('validation', { sort: 'invalid' })
  return sort
}

/** Query DSL has no CASE or NULLS LAST. Merge at most eight bounded, indexed
 * partitions, each with its own exact keyset boundary. Never sort a cut page. */
export async function orderedTaskWindow(
  ctx: Ctx,
  query: Query,
  T: Table,
  sort: string,
  cursor: TaskPosition | null,
  limit: number,
): Promise<Row[]> {
  const afterSequence = () =>
    or(gt(T.sequence, cursor!.sequence), and(eq(T.sequence, cursor!.sequence), gt(T.id, cursor!.id)))
  if (sort === 'manual')
    return ctx.db.all(
      (cursor ? query.where(afterSequence()) : query).orderBy(asc(T.sequence), asc(T.id)).limit(limit + 1),
    )
  const windows: Promise<Row[]>[] = []
  for (let priority = 0; priority < 4; priority++)
    for (const undated of [false, true]) {
      let bucket = query.where(
        priority < 3 ? eq(T.priority, priorities[priority]) : not(inArray(T.priority, priorities)),
        undated ? isNull(T.due) : not(isNull(T.due)),
      )
      if (cursor) {
        const priorityDelta = priority - rank(cursor.priority)
        const nullDelta = Number(undated) - Number(cursor.due === null)
        if (sort === 'priority' && priorityDelta < 0) continue
        if (sort === 'priority' && priorityDelta > 0) {
          /* every row is after the cursor */
        } else if (nullDelta < 0) continue
        else if (nullDelta > 0) {
          /* undated rows follow every dated row */
        } else if (undated) {
          if (priorityDelta < 0) continue
          if (priorityDelta === 0) bucket = bucket.where(afterSequence())
        } else {
          const sameDate =
            priorityDelta > 0
              ? eq(T.due, cursor.due)
              : priorityDelta === 0
                ? and(eq(T.due, cursor.due), afterSequence())
                : null
          bucket = bucket.where(sameDate ? or(gt(T.due, cursor.due), sameDate) : gt(T.due, cursor.due))
        }
      }
      windows.push(ctx.db.all(bucket.orderBy(asc(T.due), asc(T.sequence), asc(T.id)).limit(limit + 1)))
    }
  const compare = (a: Row, b: Row) => {
    const due = string(a.due || '9999').localeCompare(string(b.due || '9999'))
    const priority = rank(a.priority) - rank(b.priority)
    return (
      (sort === 'priority' ? priority || due : due || priority) ||
      Number(a.sequence) - Number(b.sequence) ||
      string(a.id).localeCompare(string(b.id))
    )
  }
  return (await Promise.all(windows))
    .flat()
    .sort(compare)
    .slice(0, limit + 1)
}
