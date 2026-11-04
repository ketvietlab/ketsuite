import { createHash } from 'node:crypto'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { backfillNativeFlowSavedViewVisibility } from './view-migration.ts'
import {
  backfillNativeFlowAssignmentOrder,
  backfillNativeFlowDependencyScope,
  backfillNativeFlowLabelScope,
  flowMigrationTransaction,
} from './migrations.ts'

const tables = [
  'flow_member',
  'flow_workspace',
  'flow_project_record',
  'flow_team',
  'flow_team_member',
  'flow_scoped_grant',
  'flow_task',
  'flow_task_assignee',
  'flow_task_label',
  'flow_task_relation',
  'flow_project',
  'flow_project_member',
  'flow_saved_view',
] as const
const authoritative = [...tables.slice(0, 7), 'flow_project', 'flow_project_member']
const canonical = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')

/** Offline inspection with counts/checksums for quarantined legacy tables too.
 * Never imports Project/ProjectMember, infers membership from ownership, publishes
 * a project or mutates any table.
 * Writers must remain stopped throughout inspection/apply/comparison. */
export async function inspectNativeFlowUpgrade(adapter: Adapter, companyId: string) {
  if (!companyId.trim()) throw new Error('E_FLOW_MIGRATION_COMPANY_REQUIRED')
  return flowMigrationTransaction(adapter, async (tx) => {
    const bind = tx.name === 'postgres' ? '$1' : '?'
    if (!(await tx.all(`SELECT id FROM company_company WHERE id=${bind}`, [companyId])).length)
      throw new Error('E_FLOW_MIGRATION_COMPANY_NOT_FOUND')
    const checks = [
      [
        'workspace',
        `SELECT w.id FROM flow_workspace w LEFT JOIN user_user u ON u.id=w."ownerId" WHERE w."companyId"=${bind} AND u.id IS NULL LIMIT 1`,
      ],
      [
        'project',
        `SELECT p.id FROM flow_project_record p LEFT JOIN flow_workspace w ON w.id=p."workspaceId" AND w."companyId"=p."companyId" LEFT JOIN user_user u ON u.id=p."ownerId" WHERE p."companyId"=${bind} AND (w.id IS NULL OR u.id IS NULL OR p.access IS NULL OR p.access NOT IN ('private','workspace')) LIMIT 1`,
      ],
      [
        'member',
        `SELECT m.id FROM flow_member m LEFT JOIN user_user u ON u.id=m."userId" WHERE m."companyId"=${bind} AND u.id IS NULL LIMIT 1`,
      ],
      [
        'grant',
        `SELECT g.id FROM flow_scoped_grant g LEFT JOIN flow_workspace w ON w.id=g."targetId" AND w."companyId"=g."companyId" LEFT JOIN flow_project_record p ON p.id=g."targetId" AND p."companyId"=g."companyId" LEFT JOIN flow_member m ON m."userId"=g."subjectId" AND m."companyId"=g."companyId" LEFT JOIN flow_team t ON t.id=g."subjectId" AND t."companyId"=g."companyId" WHERE g."companyId"=${bind} AND (g.scope NOT IN ('workspace','project') OR g."subjectType" NOT IN ('user','team') OR g.role NOT IN ('viewer','member','editor','admin') OR (g.scope='workspace' AND w.id IS NULL) OR (g.scope='project' AND p.id IS NULL) OR (g."subjectType"='user' AND m.id IS NULL) OR (g."subjectType"='team' AND t.id IS NULL)) LIMIT 1`,
      ],
      [
        'team-member',
        `SELECT r.id FROM flow_team_member r LEFT JOIN flow_team t ON t.id=r."teamId" AND t."companyId"=r."companyId" LEFT JOIN flow_member m ON m."userId"=r."memberId" AND m."companyId"=r."companyId" WHERE r."companyId"=${bind} AND (t.id IS NULL OR m.id IS NULL) LIMIT 1`,
      ],
      [
        'task',
        `SELECT t.id FROM flow_task t LEFT JOIN flow_project_record p ON p.id=t."projectId" AND p."companyId"=t."companyId" LEFT JOIN flow_task_status s ON s.id=t."columnId" AND s."companyId"=t."companyId" WHERE t."companyId"=${bind} AND (p.id IS NULL OR s.id IS NULL) LIMIT 1`,
      ],
      [
        'assignee',
        `SELECT r.id FROM flow_task_assignee r LEFT JOIN flow_task t ON t.id=r."taskId" AND t."companyId"=r."companyId" LEFT JOIN flow_member m ON m."userId"=r."userId" AND m."companyId"=r."companyId" WHERE r."companyId"=${bind} AND (t.id IS NULL OR m.id IS NULL OR r."projectId" IS NULL OR r."projectId"<>t."projectId" OR r."columnId" IS NULL OR r."columnId"<>t."columnId" OR t.priority IS NULL OR t.priority NOT IN ('urgent','high','normal')) LIMIT 1`,
      ],
      [
        'label',
        `SELECT r.id FROM flow_task_label r LEFT JOIN flow_task t ON t.id=r."taskId" AND t."companyId"=r."companyId" LEFT JOIN flow_label l ON l.id=r."labelId" AND l."companyId"=r."companyId" WHERE r."companyId"=${bind} AND (t.id IS NULL OR l.id IS NULL OR (l."projectId" IS NOT NULL AND l."projectId"<>t."projectId")) LIMIT 1`,
      ],
      [
        'relation',
        `SELECT r.id FROM flow_task_relation r LEFT JOIN flow_task s ON s.id=r."taskId" AND s."companyId"=r."companyId" LEFT JOIN flow_task t ON t.id=r."targetId" AND t."companyId"=r."companyId" WHERE r."companyId"=${bind} AND (s.id IS NULL OR t.id IS NULL OR (r.kind='blocks' AND (s."projectId"<>t."projectId" OR s."columnId" IS NULL OR t."columnId" IS NULL))) LIMIT 1`,
      ],
    ]
    for (const [name, sql] of checks)
      if ((await tx.all(sql!, [companyId])).length)
        throw new Error('E_FLOW_NATIVE_UPGRADE_REQUIRES_REPAIR:' + name)
    const records: Record<string, { count: number; checksum: string }> = {}
    const viewSource = createHash('sha256')
    for (const table of tables) {
      const hash = createHash('sha256')
      let last: string | undefined
      let count = 0
      for (;;) {
        const cursor = tx.name === 'postgres' ? '$2' : '?'
        const rows = await tx.all(
          `SELECT * FROM ${table} WHERE "companyId"=${bind}${last === undefined ? '' : ` AND id>${cursor}`} ORDER BY id LIMIT 500`,
          last === undefined ? [companyId] : [companyId, last],
        )
        for (const row of rows) {
          if (table === 'flow_saved_view') {
            const { visibility, ...source } = row
            viewSource.update(JSON.stringify(canonical(source)) + '\n')
          }
          hash.update(JSON.stringify(canonical(row)) + '\n')
          count++
        }
        if (rows.length < 500) break
        last = String(rows.at(-1)!.id)
      }
      records[table] = { count, checksum: hash.digest('hex') }
    }
    return {
      companyId,
      source: 'native-only' as const,
      tables: records,
      authoritativeChecksum: digest({
        ...Object.fromEntries(authoritative.map((t) => [t, records[t]])),
        savedViewSource: viewSource.digest('hex'),
      }),
    }
  })
}

/** Explicit, atomic operator step; no startup hook and no legacy importer. */
export async function applyNativeFlowUpgrade(adapter: Adapter, companyId: string) {
  return flowMigrationTransaction(adapter, async (tx) => {
    const before = await inspectNativeFlowUpgrade(tx, companyId)
    const changes: Row = {
      assignments: (await backfillNativeFlowAssignmentOrder(tx, companyId)).changed,
      labels: (await backfillNativeFlowLabelScope(tx, companyId)).changed,
      dependencies: (await backfillNativeFlowDependencyScope(tx, companyId)).changed,
      views: (await backfillNativeFlowSavedViewVisibility(tx, companyId)).changed,
    }
    const after = await inspectNativeFlowUpgrade(tx, companyId)
    if (
      before.authoritativeChecksum !== after.authoritativeChecksum ||
      tables.some((t) => before.tables[t]!.count !== after.tables[t]!.count)
    )
      throw new Error('E_FLOW_NATIVE_UPGRADE_INVARIANT')
    return { companyId, changes, before, after }
  })
}
