import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { confirmManualMigration, planMigration, renderSql, schemaFromManifest } from '@ketvietlab/ketjs'
import type { Adapter, Manifest, MigrationOp, Row, Schema } from '@ketvietlab/ketjs'
import { companyCatalogueModels, planCatalogueCompanyIdentities } from './company-identities.ts'
import { projectCatalogueCompanyRows, settleCatalogueCompanyProjection } from './company-projection.ts'
import type { CatalogueOwnerPolicy, CatalogueQueuedJob } from './company-projection.ts'

const LEDGER_MODEL = 'product.CatalogueIdentityMapping'
const ACTIVE_JOB_STATES = ['available', 'scheduled', 'executing', 'retryable']

export type CatalogueSplitReport = {
  /** `planned` for a dry run; `already-split` when the database is on the target schema. */
  state: 'planned' | 'applied' | 'already-split'
  /** Schema statements in the order they run; row writes happen between them. */
  statements: string[]
  clones: number
  updates: number
  mappings: number
}

type Columns = Schema['tables'][string]['columns']

/** Read values the way a KetJS function sees them, so policies compare like for like. */
const decode = (dialect: string, columns: Columns, row: Row): Row => {
  const out: Row = {}
  for (const [field, value] of Object.entries(row)) {
    const base = columns[field]?.base
    if (value == null) out[field] = value
    else if (base === 'bool') out[field] = Boolean(value)
    else if (base === 'int' && typeof value === 'string' && Number.isSafeInteger(Number(value)))
      out[field] = Number(value)
    else if (base === 'json' && dialect === 'sqlite' && typeof value === 'string')
      out[field] = JSON.parse(value)
    else out[field] = value
  }
  return out
}

/** Bind a changed value; SQLite stores JSON as text, Postgres encodes it per column. */
const encode = (dialect: string, base: string | undefined, value: unknown): unknown =>
  base === 'json' && dialect === 'sqlite' && value != null ? JSON.stringify(value) : value

/**
 * Split the catalogue by company in one transaction, from the schema the database is
 * on to `manifest`, whose catalogue models are company scoped. Reads every table and
 * the queued jobs, projects and settles the copies through the deployment's owner
 * policies, adds the `companyId` columns, writes copies and moved references, records
 * each changed identity in `product.CatalogueIdentityMapping`, and confirms the schema
 * with KetJS. Any refusal rolls back everything. A dry run plans without writing, and
 * a database already on the target schema is left alone.
 */
export async function splitCatalogueByCompany(
  adapter: Adapter,
  input: {
    manifest: Manifest
    originalCompanyId: string
    policies: readonly CatalogueOwnerPolicy[]
    dryRun?: boolean
    now?: () => string
  },
): Promise<CatalogueSplitReport> {
  if (!['sqlite', 'postgres'].includes(adapter.name))
    throw new Error('Catalogue split supports SQLite and PostgreSQL adapters only')
  const target = schemaFromManifest(input.manifest)
  const tableOf = new Map(Object.entries(target.tables).map(([table, def]) => [def.model, table]))
  const catalogue = companyCatalogueModels.filter((model) => tableOf.has(model))
  for (const model of catalogue)
    if (target.tables[tableOf.get(model)!]!.columns.companyId?.optional !== false)
      throw new Error(`Target manifest keeps ${model} shared`)
  if (!tableOf.has(LEDGER_MODEL)) throw new Error(`Target manifest lacks ${LEDGER_MODEL}`)

  const run = async (tx: Adapter): Promise<CatalogueSplitReport> => {
    const q = (name: string) => tx.quoteIdent(name)
    if (tx.name === 'postgres' && !adapter.transaction)
      await tx.exec(
        input.dryRun
          ? 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
          : 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
      )
    const marker = (await tx.all('SELECT schema FROM ket_migration WHERE id = 1'))[0]?.schema
    if (!marker) throw new Error('Catalogue split requires an applied migration schema')
    const applied = (typeof marker === 'string' ? JSON.parse(marker) : marker) as Schema
    const empty = { state: 'already-split' as const, statements: [], clones: 0, updates: 0, mappings: 0 }
    if (isDeepStrictEqual(applied, target)) return empty

    // Everything but the scope columns must already match: other changes go through
    // the ordinary migration first, so this transaction only does the split.
    const withoutScope = structuredClone(target)
    for (const model of catalogue) delete withoutScope.tables[tableOf.get(model)!]!.columns.companyId
    const catalogueTables = new Set(catalogue.map((model) => tableOf.get(model)!))
    const ops = planMigration(applied, withoutScope, { allowDestructive: true })
    const foreign = ops.filter(
      (op) => !(op.op === 'DROP_INDEX' || op.op === 'CREATE_INDEX') || !catalogueTables.has(op.table),
    )
    if (foreign.length)
      throw new Error(
        `Run the ordinary migration before the catalogue split: ${foreign.map((op) => `${op.op} ${op.table}`).join(', ')}`,
      )
    const drops: MigrationOp[] = ops.filter((op) => op.op === 'DROP_INDEX')
    const creates: MigrationOp[] = ops.filter((op) => op.op === 'CREATE_INDEX')
    const statements = [
      ...renderSql(drops, tx),
      ...[...catalogueTables].map(
        (table) =>
          `ALTER TABLE ${q(table)} ADD COLUMN ${q('companyId')} ${tx.columnSql({ base: 'text' })} NOT NULL DEFAULT ''`,
      ),
      ...renderSql(creates, tx),
      ...(tx.name === 'postgres'
        ? [...catalogueTables].map(
            (table) => `ALTER TABLE ${q(table)} ALTER COLUMN ${q('companyId')} DROP DEFAULT`,
          )
        : []),
    ]

    const snapshot: Record<string, Row[]> = {}
    for (const [table, def] of Object.entries(applied.tables))
      snapshot[def.model] = (await tx.all(`SELECT * FROM ${q(table)}`)).map((row) =>
        decode(tx.name, def.columns, row),
      )
    const jobs: CatalogueQueuedJob[] = Object.hasOwn(await tx.introspect(), 'ket_job')
      ? (
          await tx.all(
            `SELECT id, job, state, args, unique_key, company_id, companies FROM ket_job WHERE state IN (${ACTIVE_JOB_STATES.map((state) => `'${state}'`).join(', ')})`,
          )
        ).map((row) => ({
          id: String(row.id),
          job: String(row.job),
          state: String(row.state),
          args: row.args,
          uniqueKey: row.unique_key == null ? null : String(row.unique_key),
          companyId: row.company_id == null ? null : String(row.company_id),
          companies: row.companies,
        }))
      : []
    const companyIds = (snapshot['company.Company'] ?? []).map((row) => String(row.id))
    // Plan on the schema the rows are in: the catalogue is still shared there.
    const identityPlan = planCatalogueCompanyIdentities({
      schema: applied,
      originalCompanyId: input.originalCompanyId,
      companyIds,
      sourceIds: Object.fromEntries(
        catalogue.map((model) => [model, (snapshot[model] ?? []).map((row) => String(row.id))]),
      ),
    })
    const settled = settleCatalogueCompanyProjection({
      projection: projectCatalogueCompanyRows({ schema: applied, identityPlan, rows: snapshot }),
      snapshot,
      policies: input.policies,
      jobs,
    })
    const mappings = [...settled.identityPlan.identities, ...settled.operationalIdentities].filter(
      (identity) => identity.targetId !== identity.sourceId,
    )
    const clones = settled.rows.filter((row) => row.mode === 'clone')
    const updates = settled.rows.filter((row) => row.mode === 'update')
    const report = { statements, clones: clones.length, updates: updates.length, mappings: mappings.length }
    if (input.dryRun) return { state: 'planned', ...report }

    for (const statement of renderSql(drops, tx)) await tx.exec(statement)
    for (const table of catalogueTables)
      await tx.exec(
        `ALTER TABLE ${q(table)} ADD COLUMN ${q('companyId')} ${tx.columnSql({ base: 'text' })} NOT NULL DEFAULT ''`,
      )
    const sources = new Map(
      Object.entries(snapshot).map(([model, rows]) => [
        model,
        new Map(rows.map((row) => [String(row.id), row])),
      ]),
    )
    // Copies first: each copies its unchanged columns from the source row in SQL, so
    // evidence keeps its bytes, and the source row must not have been updated yet.
    for (const row of clones) {
      const table = tableOf.get(row.model)!
      const columns = target.tables[table]!.columns
      const source = sources.get(row.model)!.get(row.sourceId)!
      const fields = Object.keys(row.after).filter((field) => Object.hasOwn(columns, field))
      const params: unknown[] = []
      const values = fields.map((field) => {
        if (field !== 'companyId' && isDeepStrictEqual(row.after[field], source[field]))
          return `src.${q(field)}`
        const base = columns[field]!.base
        params.push(encode(tx.name, base, row.after[field]))
        // A select list gives Postgres no column to infer a parameter's type from.
        return tx.name === 'postgres'
          ? `CAST($${params.length} AS ${base === 'id' ? 'TEXT' : tx.columnSql({ base })})`
          : '?'
      })
      params.push(row.sourceId)
      const result = await tx.run(
        `INSERT INTO ${q(table)} (${fields.map(q).join(', ')}) SELECT ${values.join(', ')} FROM ${q(table)} src WHERE src.${q('id')} = ${tx.name === 'postgres' ? `$${params.length}` : '?'}`,
        params,
      )
      if (result.changes !== 1) throw new Error(`Catalogue copy did not find its source: ${row.model}`)
    }
    for (const row of updates) {
      const table = tableOf.get(row.model)!
      const columns = target.tables[table]!.columns
      const changed = Object.keys(row.after).filter(
        (field) => Object.hasOwn(columns, field) && !isDeepStrictEqual(row.after[field], row.before?.[field]),
      )
      if (!changed.length) continue
      const params = changed.map((field) => encode(tx.name, columns[field]!.base, row.after[field]))
      params.push(row.sourceId)
      const at = (index: number) => (tx.name === 'postgres' ? `$${index + 1}` : '?')
      const result = await tx.run(
        `UPDATE ${q(table)} SET ${changed.map((field, index) => `${q(field)} = ${at(index)}`).join(', ')} WHERE ${q('id')} = ${at(changed.length)}`,
        params,
      )
      if (result.changes !== 1) throw new Error(`Catalogue update did not find its row: ${row.model}`)
    }
    const createdAt = (input.now ?? (() => new Date().toISOString()))()
    const ledger = tableOf.get(LEDGER_MODEL)!
    for (const identity of mappings) {
      const id = `cim:${createHash('sha256')
        .update(JSON.stringify([identity.model, identity.sourceId, identity.companyId]))
        .digest('hex')}`
      const params = [id, identity.companyId, identity.model, identity.sourceId, identity.targetId, createdAt]
      await tx.run(
        `INSERT INTO ${q(ledger)} (${['id', 'companyId', 'model', 'sourceId', 'targetId', 'createdAt'].map(q).join(', ')}) VALUES (${params.map((_, index) => (tx.name === 'postgres' ? `$${index + 1}` : '?')).join(', ')})`,
        params,
      )
    }
    for (const table of catalogueTables) {
      const left = await tx.all(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q('companyId')} = ''`)
      if (Number(left[0]?.n) !== 0) throw new Error(`Catalogue rows without a company remain in ${table}`)
    }
    for (const statement of renderSql(creates, tx)) await tx.exec(statement)
    if (tx.name === 'postgres')
      for (const table of catalogueTables)
        await tx.exec(`ALTER TABLE ${q(table)} ALTER COLUMN ${q('companyId')} DROP DEFAULT`)
    await confirmManualMigration(tx, input.manifest, { now: () => createdAt })
    return { state: 'applied', ...report }
  }
  return adapter.transaction ? run(adapter) : adapter.tx(run)
}
