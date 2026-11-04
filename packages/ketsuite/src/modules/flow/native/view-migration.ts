import type { Adapter, Row } from '@ketvietlab/ketjs'
import { flowMigrationTransaction } from './migrations.ts'

/** Additive native-only mirror; explicit Company, with tenant writers stopped. */
export async function backfillNativeFlowSavedViewVisibility(adapter: Adapter, companyId: string) {
  if (!companyId.trim()) throw new Error('E_FLOW_MIGRATION_COMPANY_REQUIRED')
  return flowMigrationTransaction(adapter, async (tx) => {
    const bind = tx.name === 'postgres' ? '$1' : '?'
    const bad = await tx.all(
      `SELECT v.id FROM flow_saved_view v
      LEFT JOIN flow_project_record p ON p.id=v."projectId" AND p."companyId"=v."companyId"
      LEFT JOIN flow_workspace w ON w.id=v."workspaceId" AND w."companyId"=v."companyId"
      LEFT JOIN user_user u ON u.id=v."ownerId"
      WHERE v."companyId"=${bind} AND (u.id IS NULL OR (v."projectId" IS NOT NULL AND p.id IS NULL)
        OR (v."workspaceId" IS NOT NULL AND w.id IS NULL)) LIMIT 1`,
      [companyId],
    )
    if (bad.length) throw new Error('E_FLOW_VIEW_BACKFILL_REQUIRES_REPAIR')
    let changed = 0,
      last: string | undefined
    for (;;) {
      const rows = await tx.all(
        `SELECT id, query, "projectId" FROM flow_saved_view WHERE "companyId"=${bind} AND visibility IS NULL${last === undefined ? '' : ` AND id>${tx.name === 'postgres' ? '$2' : '?'}`} ORDER BY id LIMIT 200`,
        last === undefined ? [companyId] : [companyId, last],
      )
      if (!rows.length) break
      for (const row of rows) {
        let query: Row
        try {
          query = typeof row.query === 'string' ? JSON.parse(row.query) : (row.query as Row)
        } catch {
          throw new Error('E_FLOW_VIEW_BACKFILL_REQUIRES_REPAIR')
        }
        if (
          (query?.visibility === 'project' && !row.projectId) ||
          !query ||
          Array.isArray(query) ||
          typeof query !== 'object' ||
          !['private', 'project'].includes(String(query.visibility ?? 'private'))
        )
          throw new Error('E_FLOW_VIEW_BACKFILL_REQUIRES_REPAIR')
        const values = [String(query.visibility ?? 'private'), companyId, row.id]
        const marks = tx.name === 'postgres' ? ['$1', '$2', '$3'] : ['?', '?', '?']
        changed += (
          await tx.run(
            `UPDATE flow_saved_view SET visibility=${marks[0]} WHERE "companyId"=${marks[1]} AND id=${marks[2]} AND visibility IS NULL`,
            values,
          )
        ).changes
      }
      last = String(rows.at(-1)!.id)
    }
    return { companyId, changed }
  })
}
