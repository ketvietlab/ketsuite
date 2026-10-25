import type { Adapter } from '@ketvietlab/ketjs'

/** Explicit post-schema migration for existing native Core data. No legacy
 * Issue/Project grants are imported and no new membership is ever created.
 * Run with tenant writers stopped, after the non-destructive schema migration.
 * Real-tenant execution requires the owner's migration approval. */
export async function backfillNativeFlowAssignmentOrder(adapter: Adapter, companyId: string) {
  if (!companyId) throw new Error('E_FLOW_MIGRATION_COMPANY_REQUIRED')
  const pg = adapter.name === 'postgres',
    binding = pg ? '$1' : '?'
  return adapter.tx(async (tx) => {
    const bad = await tx.all(
      `SELECT a.id FROM flow_task_assignee a LEFT JOIN flow_task t
      ON t.id=a."taskId" AND t."companyId"=a."companyId"
      WHERE a."companyId"=${binding} AND (t.id IS NULL OR t.priority NOT IN ('urgent','high','normal')) LIMIT 1`,
      [companyId],
    )
    if (bad.length) throw new Error('E_FLOW_ASSIGNMENT_BACKFILL_REQUIRES_REPAIR')
    const compare = pg ? 'IS DISTINCT FROM' : 'IS NOT'
    const sql = pg
      ? `UPDATE flow_task_assignee a SET due=t.due, priority=t.priority
      FROM flow_task t WHERE a."companyId"=$1 AND t."companyId"=a."companyId" AND t.id=a."taskId"
      AND (a.due ${compare} t.due OR a.priority ${compare} t.priority)`
      : `UPDATE flow_task_assignee AS a SET due=(SELECT t.due FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId"),
        priority=(SELECT t.priority FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId")
      WHERE a."companyId"=? AND EXISTS (SELECT 1 FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId"
        AND (a.due ${compare} t.due OR a.priority ${compare} t.priority))`
    const result = await tx.run(sql, [companyId])
    return { companyId, changed: result.changes }
  })
}

/** Explicit Company-fenced upgrade for label usage; no startup data mutation. */
export async function backfillNativeFlowLabelScope(adapter: Adapter, companyId: string) {
  if (!companyId) throw new Error('E_FLOW_MIGRATION_COMPANY_REQUIRED')
  const pg = adapter.name === 'postgres',
    binding = pg ? '$1' : '?'
  return adapter.tx(async (tx) => {
    const bad = await tx.all(
      `SELECT a.id FROM flow_task_label a LEFT JOIN flow_task t
      ON t.id=a."taskId" AND t."companyId"=a."companyId"
      LEFT JOIN flow_label l ON l.id=a."labelId" AND l."companyId"=a."companyId"
      WHERE a."companyId"=${binding} AND (t.id IS NULL OR l.id IS NULL OR t."projectId" IS NULL
        OR (l."projectId" IS NOT NULL AND l."projectId" <> t."projectId")) LIMIT 1`,
      [companyId],
    )
    if (bad.length) throw new Error('E_FLOW_LABEL_BACKFILL_REQUIRES_REPAIR')
    const compare = pg ? 'IS DISTINCT FROM' : 'IS NOT'
    const sql = pg
      ? `UPDATE flow_task_label a SET "projectId"=t."projectId", archived=t.archived
      FROM flow_task t WHERE a."companyId"=$1 AND t."companyId"=a."companyId" AND t.id=a."taskId"
      AND (a."projectId" ${compare} t."projectId" OR a.archived ${compare} t.archived)`
      : `UPDATE flow_task_label AS a SET "projectId"=(SELECT t."projectId" FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId"),
        archived=(SELECT t.archived FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId")
      WHERE a."companyId"=? AND EXISTS (SELECT 1 FROM flow_task t WHERE t.id=a."taskId" AND t."companyId"=a."companyId"
        AND (a."projectId" ${compare} t."projectId" OR a.archived ${compare} t.archived))`
    const result = await tx.run(sql, [companyId])
    return { companyId, changed: result.changes }
  })
}

/** Backfill dependency read mirrors with both ends validated in one Company. */
export async function backfillNativeFlowDependencyScope(adapter: Adapter, companyId: string) {
  if (!companyId) throw new Error('E_FLOW_MIGRATION_COMPANY_REQUIRED')
  const pg = adapter.name === 'postgres',
    binding = pg ? '$1' : '?'
  return adapter.tx(async (tx) => {
    const bad = await tx.all(
      `SELECT r.id FROM flow_task_relation r
      LEFT JOIN flow_task s ON s.id=r."taskId" AND s."companyId"=r."companyId"
      LEFT JOIN flow_task t ON t.id=r."targetId" AND t."companyId"=r."companyId"
      WHERE r."companyId"=${binding} AND r.kind='blocks' AND (s.id IS NULL OR t.id IS NULL
        OR s."projectId" IS NULL OR t."projectId" IS NULL OR s."projectId" <> t."projectId"
        OR s."columnId" IS NULL OR t."columnId" IS NULL) LIMIT 1`,
      [companyId],
    )
    if (bad.length) throw new Error('E_FLOW_DEPENDENCY_BACKFILL_REQUIRES_REPAIR')
    const compare = pg ? 'IS DISTINCT FROM' : 'IS NOT'
    const changed = `(r."projectId" ${compare} s."projectId" OR r."sourceStatusId" ${compare} s."columnId"
      OR r."targetStatusId" ${compare} t."columnId" OR r."sourceArchived" ${compare} s.archived
      OR r."targetArchived" ${compare} t.archived OR r.ready ${compare} true OR r."targetDue" ${compare} t.due OR r."riskReady" ${compare} true)`
    const sql = pg
      ? `UPDATE flow_task_relation r SET "projectId"=s."projectId", "sourceStatusId"=s."columnId",
      "targetStatusId"=t."columnId", "sourceArchived"=s.archived, "targetArchived"=t.archived, "targetDue"=t.due, "riskReady"=true, ready=true
      FROM flow_task s, flow_task t WHERE r."companyId"=$1 AND r.kind='blocks'
      AND s.id=r."taskId" AND s."companyId"=r."companyId" AND t.id=r."targetId" AND t."companyId"=r."companyId" AND ${changed}`
      : `UPDATE flow_task_relation AS r SET
        "projectId"=(SELECT s."projectId" FROM flow_task s WHERE s.id=r."taskId" AND s."companyId"=r."companyId"),
        "sourceStatusId"=(SELECT s."columnId" FROM flow_task s WHERE s.id=r."taskId" AND s."companyId"=r."companyId"),
        "targetStatusId"=(SELECT t."columnId" FROM flow_task t WHERE t.id=r."targetId" AND t."companyId"=r."companyId"),
        "sourceArchived"=(SELECT s.archived FROM flow_task s WHERE s.id=r."taskId" AND s."companyId"=r."companyId"),
        "targetArchived"=(SELECT t.archived FROM flow_task t WHERE t.id=r."targetId" AND t."companyId"=r."companyId"),
        "targetDue"=(SELECT t.due FROM flow_task t WHERE t.id=r."targetId" AND t."companyId"=r."companyId"), "riskReady"=true, ready=true
      WHERE r."companyId"=? AND r.kind='blocks' AND EXISTS (SELECT 1 FROM flow_task s, flow_task t
        WHERE s.id=r."taskId" AND s."companyId"=r."companyId" AND t.id=r."targetId" AND t."companyId"=r."companyId" AND ${changed})`
    const result = await tx.run(sql, [companyId])
    return { companyId, changed: result.changes }
  })
}
