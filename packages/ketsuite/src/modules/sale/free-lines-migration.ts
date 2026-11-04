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
export async function migrateSaleFreeLines(adapter: Adapter, manifest: Manifest) {
  if (!['sqlite', 'postgres'].includes(adapter.name)) throw new Error('Unsupported Sales migration adapter')
  return adapter.tx(async (tx) => {
    const checked = await verifyPhysicalSchema(tx, manifest)
    if (checked.markerIssues.length) throw new Error('Sales migration refuses physical schema drift')
    if (checked.ok && checked.markerMatchesManifest) return { state: 'already-applied' as const }
    if (!checked.applied) throw new Error('Migrate a fresh database normally before applying Sales changes')
    const target = schemaFromManifest(manifest)
    const normalized = structuredClone(checked.applied)
    const previous = normalized.tables.sale_order_line
    const next = target.tables.sale_order_line
    if (!previous || !next) throw new Error('Sales line schema is missing')
    for (const field of ['productId', 'productUomId']) {
      if (!previous.columns[field] || next.columns[field]?.optional !== true)
        throw new Error('Unexpected Sales line identity contract')
      previous.columns[field] = { ...previous.columns[field]!, optional: true }
    }
    if (!isDeepStrictEqual(previous, next))
      throw new Error('Unrelated Sales line migration requires a separate plan')
    const additions = planMigration(normalized, target)
    if (
      additions.some(
        (op) =>
          !('table' in op) ||
          op.table !== 'sale_configuration' ||
          !['CREATE_TABLE', 'CREATE_INDEX'].includes(op.op),
      )
    )
      throw new Error('Unrelated schema changes require a separate migration')
    if (tx.name === 'postgres') {
      await tx.exec(
        'ALTER TABLE sale_order_line ALTER COLUMN "productId" DROP NOT NULL, ALTER COLUMN "productUomId" DROP NOT NULL',
      )
    } else {
      const schema = await tx.all(
        "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'sale_order_line' AND sql IS NOT NULL",
      )
      const table = schema.find((row) => row.type === 'table')
      if (!table) throw new Error('Sales line table is missing')
      // Preserve the original declaration, including constraints outside the model registry.
      let ddl = String(table.sql).replace(
        /^CREATE TABLE (?:"sale_order_line"|sale_order_line)/iu,
        'CREATE TABLE "sale_order_line__free_lines"',
      )
      if (!ddl.includes('"sale_order_line__free_lines"'))
        throw new Error('Unsupported Sales table declaration')
      for (const field of ['productId', 'productUomId'])
        ddl = ddl.replace(new RegExp(`("${field}"\\s+TEXT)\\s+NOT NULL`, 'iu'), '$1')
      // Reject inbound physical foreign keys: DROP TABLE can run cascades under SQLite.
      for (const row of await tx.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )) {
        const name = String(row.name).replaceAll('"', '""')
        if ((await tx.all(`PRAGMA foreign_key_list("${name}")`)).some((fk) => fk.table === 'sale_order_line'))
          throw new Error('Sales migration needs an operator plan for inbound physical foreign keys')
      }
      const columns = (await tx.all('PRAGMA table_info("sale_order_line")'))
        .map((row) => `"${String(row.name).replaceAll('"', '""')}"`)
        .join(', ')
      await tx.exec(ddl)
      await tx.exec(
        `INSERT INTO sale_order_line__free_lines (${columns}) SELECT ${columns} FROM sale_order_line`,
      )
      await tx.exec('DROP TABLE sale_order_line')
      await tx.exec('ALTER TABLE sale_order_line__free_lines RENAME TO sale_order_line')
      for (const item of schema.filter((row) => row.type !== 'table')) await tx.exec(String(item.sql))
    }
    for (const statement of renderSql(additions, tx)) await tx.exec(statement)
    await confirmManualMigration(tx, manifest)
    return { state: 'applied' as const }
  })
}
