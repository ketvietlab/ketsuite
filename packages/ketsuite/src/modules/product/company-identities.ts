import { createHash } from 'node:crypto'
import type { Schema } from '@ketvietlab/ketjs'

import { companyCatalogueModels } from './company-catalogue.ts'

export { companyCatalogueModels }

export type CatalogueCompanyIdentity = {
  model: string
  sourceId: string
  companyId: string
  targetId: string
}

export type CatalogueReference = {
  model: string
  table: string
  field: string
  target: string
  scope: 'catalogue' | 'company' | 'shared'
}

export type CatalogueIdentityPlan = {
  version: 1
  originalCompanyId: string
  companyIds: string[]
  identities: CatalogueCompanyIdentity[]
  references: CatalogueReference[]
  /** These consumers need an explicit migration policy before any data can be written. */
  unresolvedSharedConsumers: string[]
  digest: string
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const identityKey = (model: string, sourceId: string, companyId: string): string =>
  JSON.stringify([model, sourceId, companyId])

// JSON/JSONB stores may reorder object properties; the digest must survive that round trip.
const planDigest = (plan: Omit<CatalogueIdentityPlan, 'digest'>): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        version: plan.version,
        originalCompanyId: plan.originalCompanyId,
        companyIds: plan.companyIds,
        identities: plan.identities.map(({ model, sourceId, companyId, targetId }) => [
          model,
          sourceId,
          companyId,
          targetId,
        ]),
        references: plan.references.map(({ model, table, field, target, scope }) => [
          model,
          table,
          field,
          target,
          scope,
        ]),
        unresolvedSharedConsumers: plan.unresolvedSharedConsumers,
      }),
    )
    .digest('hex')

const assertId = (value: string, context: string): void => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
    throw new Error(`Invalid catalogue identity: ${context}`)
}

/**
 * Produce a deterministic identity mapping, without reading or writing a database.
 *
 * The explicitly selected original company keeps every original primary key. Each
 * other company receives an independent copy, including inactive/unreferenced rows.
 * Neither company order nor database row order may change this mapping on retry.
 *
 * This is an identity plan, NOT an executable data migration. Its reference graph
 * covers typed references only. The caller still owns encoded identities, company
 * references on shared rows, polymorphic references, immutable evidence and DDL.
 */
export function planCatalogueCompanyIdentities(input: {
  schema: Schema
  originalCompanyId: string
  companyIds: readonly string[]
  /** A complete ID inventory for every installed catalogue model, including empty models. */
  sourceIds: Readonly<Record<string, readonly string[]>>
}): CatalogueIdentityPlan {
  const { schema, originalCompanyId, sourceIds } = input
  assertId(originalCompanyId, 'original company')
  const companyIds = [...input.companyIds].sort(compare)
  const companies = new Set(companyIds)
  if (companies.size !== companyIds.length) throw new Error('Duplicate catalogue company')
  for (const id of companyIds) assertId(id, 'company')
  if (!companies.has(originalCompanyId)) throw new Error('Original catalogue company does not exist')

  const tables = new Map<string, { name: string; definition: Schema['tables'][string] }>()
  for (const [name, definition] of Object.entries(schema.tables)) {
    if (tables.has(definition.model)) throw new Error(`Duplicate schema model: ${definition.model}`)
    tables.set(definition.model, { name, definition })
  }
  const models = companyCatalogueModels.filter((model) => tables.has(model)).sort(compare)
  const catalogue = new Set<string>(models)
  if (!catalogue.has('product.Template') || !catalogue.has('product.Product'))
    throw new Error('Catalogue identity planning requires product.Template and product.Product')
  for (const model of Object.keys(sourceIds))
    if (!catalogue.has(model)) throw new Error(`Unexpected catalogue inventory: ${model}`)

  const identities: CatalogueCompanyIdentity[] = []
  for (const model of models) {
    const table = tables.get(model)!.definition
    if (table.columns.companyId) throw new Error(`Catalogue model is already company scoped: ${model}`)
    if (!Object.hasOwn(sourceIds, model)) throw new Error(`Missing catalogue inventory: ${model}`)
    const ids = [...sourceIds[model]!].sort(compare)
    const occupied = new Set(ids)
    if (occupied.size !== ids.length) throw new Error(`Duplicate source identity: ${model}`)
    for (const sourceId of ids) assertId(sourceId, model)
    for (const sourceId of ids) {
      for (const companyId of companyIds) {
        const targetId =
          companyId === originalCompanyId
            ? sourceId
            : `pc1:${createHash('sha256')
                .update(identityKey(model, sourceId, companyId))
                .digest('hex')}`
        if (companyId !== originalCompanyId) {
          if (occupied.has(targetId)) throw new Error(`Catalogue target identity collision: ${model}`)
          occupied.add(targetId)
        }
        identities.push({ model, sourceId, companyId, targetId })
      }
    }
  }

  const references: CatalogueReference[] = []
  for (const [model, { name, definition }] of tables) {
    for (const [field, column] of Object.entries(definition.columns)) {
      if (column.base !== 'ref' || !column.target || !catalogue.has(column.target)) continue
      references.push({
        model,
        table: name,
        field,
        target: column.target,
        scope: catalogue.has(model) ? 'catalogue' : definition.columns.companyId ? 'company' : 'shared',
      })
    }
  }
  references.sort((a, b) =>
    compare(identityKey(a.model, a.field, a.target), identityKey(b.model, b.field, b.target)),
  )
  const unresolvedSharedConsumers = [
    ...new Set(references.filter((ref) => ref.scope === 'shared').map((ref) => ref.model)),
  ].sort(compare)
  const plan = {
    version: 1 as const,
    originalCompanyId,
    companyIds,
    identities,
    references,
    unresolvedSharedConsumers,
  }
  return { ...plan, digest: planDigest(plan) }
}

/** Missing references must abort migration; silently retaining a source ID crosses company boundaries. */
export function catalogueIdentityResolver(
  plan: CatalogueIdentityPlan,
): (model: string, sourceId: string, companyId: string) => string {
  const identities = new Map<string, string>()
  const targets = new Set<string>()
  const companies = new Set(plan.companyIds)
  if (
    plan.version !== 1 ||
    companies.size !== plan.companyIds.length ||
    !companies.has(plan.originalCompanyId)
  )
    throw new Error('Invalid catalogue identity plan')
  const { digest, ...content } = plan
  if (planDigest(content) !== digest) throw new Error('Catalogue identity plan digest mismatch')
  for (const identity of plan.identities) {
    const { model, sourceId, companyId, targetId } = identity
    for (const value of [model, sourceId, companyId, targetId]) assertId(value, 'persisted mapping')
    if (!companies.has(companyId)) throw new Error('Unknown company in catalogue mapping')
    if (companyId === plan.originalCompanyId && targetId !== sourceId)
      throw new Error('Original catalogue identity changed')
    const key = identityKey(model, sourceId, companyId)
    const target = JSON.stringify([model, targetId])
    if (identities.has(key) || targets.has(target)) throw new Error('Duplicate catalogue mapping identity')
    identities.set(key, targetId)
    targets.add(target)
  }
  return (model, sourceId, companyId) => {
    const targetId = identities.get(identityKey(model, sourceId, companyId))
    if (targetId === undefined) throw new Error(`Unresolved catalogue reference: ${model}`)
    return targetId
  }
}
