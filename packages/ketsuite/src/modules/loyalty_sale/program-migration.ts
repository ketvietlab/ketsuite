import { isDeepStrictEqual } from 'node:util'
import {
  confirmManualMigration,
  planMigration,
  renderSql,
  schemaFromManifest,
  verifyPhysicalSchema,
} from '@ketvietlab/ketjs'
import type { Adapter, Manifest } from '@ketvietlab/ketjs'

/** Explicit operator-owned migration; never invoked automatically by a request or module load. */
export async function migrateSalePromotionPrograms(adapter: Adapter, manifest: Manifest) {
  if (!['sqlite', 'postgres'].includes(adapter.name))
    throw new Error('Unsupported Sales promotion migration adapter')
  return adapter.tx(async (tx) => {
    const checked = await verifyPhysicalSchema(tx, manifest)
    if (checked.markerIssues.length)
      throw new Error('Sales promotion migration refuses physical schema drift')
    if (checked.ok && checked.markerMatchesManifest) return { state: 'already-applied' as const }
    if (!checked.applied)
      throw new Error('Migrate a fresh database normally before applying Sales promotion changes')
    const target = schemaFromManifest(manifest)
    const normalized = structuredClone(checked.applied)
    const previous = normalized.tables.loyalty_reward
    const next = target.tables.loyalty_reward
    if (!previous || !next) throw new Error('Loyalty reward schema is missing')
    for (const field of ['lineProductId']) {
      if (!previous.columns[field] || next.columns[field]?.optional !== true)
        throw new Error('Unexpected Loyalty reward identity contract')
      previous.columns[field] = { ...previous.columns[field]!, optional: true }
    }
    if (!isDeepStrictEqual(previous, next))
      throw new Error('Unrelated Loyalty reward migration requires a separate plan')
    const additions = planMigration(normalized, target)
    if (
      additions.some(
        (op) =>
          !('table' in op) ||
          !(
            (['loyalty_program_namespace', 'loyalty_rule_category', 'loyalty_rule_tag'].includes(op.table) &&
              ['CREATE_TABLE', 'CREATE_INDEX'].includes(op.op)) ||
            (op.op === 'ADD_COLUMN' &&
              (
                {
                  loyalty_program: 'salePolicyVersion',
                  loyalty_rule: 'salePointStep',
                  loyalty_wallet: 'saleExpiresOn',
                } as Record<string, string>
              )[op.table] === op.column)
          ),
      )
    )
      throw new Error('Unrelated schema changes require a separate migration')
    if (tx.name === 'postgres') {
      await tx.exec('ALTER TABLE loyalty_reward ALTER COLUMN "lineProductId" DROP NOT NULL')
    } else {
      const schema = await tx.all(
        "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'loyalty_reward' AND sql IS NOT NULL",
      )
      const table = schema.find((row) => row.type === 'table')
      if (!table) throw new Error('Loyalty reward table is missing')
      // Preserve the original declaration, including constraints outside the model registry.
      let ddl = String(table.sql).replace(
        /^CREATE TABLE (?:"loyalty_reward"|loyalty_reward)/iu,
        'CREATE TABLE "loyalty_reward__sale_programs"',
      )
      if (!ddl.includes('"loyalty_reward__sale_programs"'))
        throw new Error('Unsupported Loyalty reward table declaration')
      for (const field of ['lineProductId'])
        ddl = ddl.replace(new RegExp(`("${field}"\\s+TEXT)\\s+NOT NULL`, 'iu'), '$1')
      // Reject inbound physical foreign keys: DROP TABLE can run cascades under SQLite.
      for (const row of await tx.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )) {
        const name = String(row.name).replaceAll('"', '""')
        if ((await tx.all(`PRAGMA foreign_key_list("${name}")`)).some((fk) => fk.table === 'loyalty_reward'))
          throw new Error(
            'Sales promotion migration needs an operator plan for inbound physical foreign keys',
          )
      }
      const columns = (await tx.all('PRAGMA table_info("loyalty_reward")'))
        .map((row) => `"${String(row.name).replaceAll('"', '""')}"`)
        .join(', ')
      await tx.exec(ddl)
      await tx.exec(
        `INSERT INTO loyalty_reward__sale_programs (${columns}) SELECT ${columns} FROM loyalty_reward`,
      )
      await tx.exec('DROP TABLE loyalty_reward')
      await tx.exec('ALTER TABLE loyalty_reward__sale_programs RENAME TO loyalty_reward')
      for (const item of schema.filter((row) => row.type !== 'table')) await tx.exec(String(item.sql))
    }
    for (const statement of renderSql(additions, tx)) await tx.exec(statement)
    await confirmManualMigration(tx, manifest)
    return { state: 'applied' as const }
  })
}
