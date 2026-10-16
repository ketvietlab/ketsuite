import { addDecimals } from '../account/money.ts'
import { eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { audienceHolds, caseAudience } from './operations.ts'
import { companyRows, objectOf } from './import-policy.ts'

/** Outcomes of unique records, never counts of CSV rows merged into the same record. */
export async function importPerformance(ctx: Ctx, id: string) {
  const receipts = await companyRows(ctx, 'crm.ImportRow', { batchId: id, companyId: ctx.scope.company })
  const ids = [...new Set(receipts.map((row) => row.caseId).filter(Boolean))]
  const audience = await caseAudience(ctx)
  const rows: Row[] = [],
    timelines: Row[] = [],
    details: Row[] = [],
    links: Row[] = []
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500)
    rows.push(
      ...(await ctx.db.all(
        from(ctx.table('crm.Case')).where(
          inArray(ctx.table('crm.Case').id, chunk),
          eq(ctx.table('crm.Case').active, true),
          eq(ctx.table('crm.Case').companyId, ctx.scope.company),
        ),
      )),
    )
    timelines.push(
      ...(await ctx.db.all(
        from(ctx.table('crm.TimelineEntry')).where(inArray(ctx.table('crm.TimelineEntry').caseId, chunk)),
      )),
    )
    details.push(
      ...(await ctx.db.all(
        from(ctx.table('crm.SalesDetail')).where(inArray(ctx.table('crm.SalesDetail').caseId, chunk)),
      )),
    )
    links.push(
      ...(await ctx.db.all(
        from(ctx.table('crm.CaseTag')).where(inArray(ctx.table('crm.CaseTag').caseId, chunk)),
      )),
    )
  }
  const visible = rows.filter((row) => audienceHolds(audience, row)),
    users = await ctx.db.select('user.User', { active: true }),
    tags = await companyRows(ctx, 'crm.Tag', { companyId: ctx.scope.company })
  const contacted = new Set(
    timelines
      .filter(
        (entry) =>
          entry.eventType === 'interaction' && objectOf<Row>(entry.metadata, {}).outcome === 'reached',
      )
      .map((entry) => entry.caseId),
  )
  const detailByCase = new Map(details.map((detail) => [detail.caseId, detail]))
  const tagsByCase = new Map<unknown, Set<unknown>>()
  for (const link of links) {
    if (!tagsByCase.has(link.caseId)) tagsByCase.set(link.caseId, new Set())
    tagsByCase.get(link.caseId)!.add(link.tagId)
  }
  const summarize = (records: Row[]) => ({
    total: records.length,
    contacted: records.filter((row) => contacted.has(row.id)).length,
    won: records.filter((row) => row.terminalState === 'won').length,
    wonValue: records
      .filter((row) => row.terminalState === 'won')
      .reduce((sum, row) => addDecimals(sum, String(detailByCase.get(row.id)?.expectedRevenue || '0')), '0'),
  })
  return {
    ...summarize(visible),
    byOwner: [...new Set(visible.map((row) => String(row.assigneeUserId || '')))].map((userId) => ({
      id: userId || 'unassigned',
      name: users.find((user) => user.id === userId)?.name || '—',
      ...summarize(visible.filter((row) => String(row.assigneeUserId || '') === userId)),
    })),
    byTag: tags
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        ...summarize(visible.filter((row) => tagsByCase.get(row.id)?.has(tag.id))),
      }))
      .filter((tag) => tag.total),
  }
}
