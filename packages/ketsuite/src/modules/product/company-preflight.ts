import type { Adapter, Schema } from '@ketvietlab/ketjs'
import { companyCatalogueModels, planCatalogueCompanyIdentities } from './company-identities.ts'
import type { CatalogueIdentityPlan } from './company-identities.ts'

/**
 * Read an existing tenant's complete identity inventory in one database snapshot.
 * This does not migrate a schema, persist a mapping, update rows or call services.
 * Use the applied schema: extensions and old consumers must not disappear just
 * because the executable's current manifest no longer includes them.
 */
export async function inspectCatalogueCompanyIdentities(
  adapter: Adapter,
  originalCompanyId: string,
): Promise<CatalogueIdentityPlan> {
  if (!['sqlite', 'postgres'].includes(adapter.name))
    throw new Error('Catalogue preflight supports SQLite and PostgreSQL adapters only')
  const inspect = async (tx: Adapter): Promise<CatalogueIdentityPlan> => {
    if (tx.name === 'postgres') {
      if (!adapter.transaction) await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      else {
        const isolation = await tx.all('SHOW transaction_isolation')
        if (!['repeatable read', 'serializable'].includes(String(isolation[0]?.transaction_isolation)))
          throw new Error('Catalogue preflight requires a repeatable-read or serializable transaction')
      }
    }
    const applied = await tx.all('SELECT schema FROM ket_migration WHERE id = 1')
    const stored = applied[0]?.schema
    if (!stored) throw new Error('Catalogue preflight requires an applied migration schema')
    const schema = (typeof stored === 'string' ? JSON.parse(stored) : stored) as Schema
    if (schema?.version !== 1 || !schema.tables || typeof schema.tables !== 'object')
      throw new Error('Unsupported applied catalogue schema')
    const tables = new Map(
      Object.entries(schema.tables).map(([table, definition]) => [definition.model, table]),
    )
    const companyTable = tables.get('company.Company')
    if (!companyTable) throw new Error('Catalogue preflight requires company.Company')
    const ids = async (table: string): Promise<string[]> => {
      const rows = await tx.all(`SELECT ${tx.quoteIdent('id')} FROM ${tx.quoteIdent(table)}`)
      return rows.map((row) => {
        if (typeof row.id !== 'string') throw new Error('Catalogue preflight found a non-string identity')
        return row.id
      })
    }
    const companyIds = await ids(companyTable)
    const sourceIds: Record<string, string[]> = {}
    for (const model of companyCatalogueModels) {
      const table = tables.get(model)
      if (table) sourceIds[model] = await ids(table)
    }
    return planCatalogueCompanyIdentities({ schema, originalCompanyId, companyIds, sourceIds })
  }
  return adapter.transaction ? inspect(adapter) : adapter.tx(inspect)
}
