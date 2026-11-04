import type { Row, Schema } from '@ketvietlab/ketjs'
import {
  catalogueIdentityResolver,
  companyCatalogueModels,
  planCatalogueCompanyIdentities,
} from './company-identities.ts'
import type { CatalogueCompanyIdentity, CatalogueIdentityPlan } from './company-identities.ts'

export type CatalogueProjectedRow = {
  model: string
  sourceId: string
  companyId: string
  mode: 'clone' | 'update'
  before: Row | null
  after: Row
}

export type CatalogueProjectionReview = {
  model: string
  sourceId: string
  field: string
  reason: 'opaque-json' | 'opaque-hash' | 'company-reference-on-catalogue'
}

export type CatalogueCompanyProjection = {
  identityPlan: CatalogueIdentityPlan
  /** Includes operational primary keys whose lookup contract derives from the product ID. */
  operationalIdentities: CatalogueCompanyIdentity[]
  rows: CatalogueProjectedRow[]
  /** Every entry needs an owner policy before an executor may apply this projection. */
  pendingReviews: CatalogueProjectionReview[]
}

const key = (model: string, id: string): string => JSON.stringify([model, id])
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const idDetector = (ids: Iterable<string>): ((value: unknown) => boolean) => {
  const known = new Set(ids)
  const carries = (value: unknown): boolean => {
    if (typeof value === 'string')
      return known.has(value) || value.split(/[\s,;/?&=#|"'()<>[\]{}]+/).some((token) => known.has(token))
    if (Array.isArray(value)) return value.some(carries)
    if (value && typeof value === 'object')
      return Object.entries(value).some(([field, item]) => known.has(field) || carries(item))
    return false
  }
  return carries
}

/**
 * Whether a JSON value still names a source catalogue or rekeyed cost/quant ID, by the
 * same rule the projection uses to raise an `opaque-json` review. An owner policy that
 * rewrites a field uses it to confirm nothing it does not understand is left behind.
 */
export const catalogueIdDetector = (projection: CatalogueCompanyProjection): ((value: unknown) => boolean) =>
  idDetector([
    ...projection.identityPlan.identities.map((identity) => identity.sourceId),
    ...projection.operationalIdentities.map((identity) => identity.sourceId),
  ])

/**
 * Project catalogue copies and typed operational references without writing a database.
 * Input is a complete, consistent snapshot. Scalar business values, timestamps and
 * immutable JSON remain unchanged; unresolved evidence policies stay explicit.
 */
export function projectCatalogueCompanyRows(input: {
  schema: Schema
  identityPlan: CatalogueIdentityPlan
  rows: Readonly<Record<string, readonly Row[]>>
}): CatalogueCompanyProjection {
  const { schema, identityPlan } = input
  const resolve = catalogueIdentityResolver(identityPlan)
  const tables = new Map(
    Object.values(schema.tables)
      .sort((a, b) => compare(a.model, b.model))
      .map((table) => [table.model, table]),
  )
  const catalogue = new Set<string>(companyCatalogueModels.filter((model) => tables.has(model)))
  const snapshots = new Map<string, Map<string, Row>>()
  for (const [model, table] of tables) {
    if (!Object.hasOwn(input.rows, model)) throw new Error(`Missing projection snapshot: ${model}`)
    const rows = new Map<string, Row>()
    for (const row of input.rows[model]!) {
      if (typeof row.id !== 'string' || !row.id) throw new Error(`Invalid projection identity: ${model}`)
      if (rows.has(row.id)) throw new Error(`Duplicate projection identity: ${model}`)
      for (const field of Object.keys(row))
        if (!Object.hasOwn(table.columns, field))
          throw new Error(`Unknown snapshot column: ${model}.${field}`)
      rows.set(row.id, structuredClone(row))
    }
    snapshots.set(model, new Map([...rows].sort(([a], [b]) => compare(a, b))))
  }
  const actualCompanies = [...(snapshots.get('company.Company')?.keys() ?? [])].sort(compare)
  if (!same(actualCompanies, [...identityPlan.companyIds].sort(compare)))
    throw new Error('Projection company snapshot differs from identity plan')
  const sourceIds = Object.fromEntries(
    [...catalogue].map((model) => [model, [...snapshots.get(model)!.keys()]]),
  )
  const installed = planCatalogueCompanyIdentities({
    schema,
    originalCompanyId: identityPlan.originalCompanyId,
    companyIds: identityPlan.companyIds,
    sourceIds,
  })
  if (installed.digest !== identityPlan.digest)
    throw new Error('Projection snapshot differs from identity plan')
  if (identityPlan.unresolvedSharedConsumers.length)
    throw new Error(
      `Unresolved shared catalogue consumers: ${identityPlan.unresolvedSharedConsumers.join(', ')}`,
    )
  const companies = new Set(identityPlan.companyIds)
  const companyOf = (row: Row, model: string): string => {
    if (typeof row.companyId !== 'string' || !companies.has(row.companyId))
      throw new Error(`Unknown projection company: ${model}`)
    return row.companyId
  }
  const rowFor = (model: string, id: unknown): Row => {
    if (typeof id !== 'string') throw new Error(`Invalid typed reference: ${model}`)
    const row = snapshots.get(model)?.get(id)
    if (!row) throw new Error(`Missing referenced row: ${model}`)
    return row
  }

  const operationalIdentities: CatalogueCompanyIdentity[] = []
  const operationMap = new Map<string, CatalogueCompanyIdentity>()
  for (const model of ['product.Cost', 'stock.Quant']) {
    const rows = snapshots.get(model)
    if (!rows) continue
    const targets = new Set<string>()
    for (const [sourceId, row] of rows) {
      const companyId = companyOf(row, model)
      rowFor('product.Product', row.productId)
      const productId = resolve('product.Product', String(row.productId), companyId)
      const targetId =
        productId === row.productId
          ? sourceId
          : model === 'product.Cost'
            ? `${companyId}:${productId}`
            : `${companyId}:${productId}:${String(row.locationId)}:${row.lotId == null || row.lotId === '' ? '_' : String(row.lotId)}`
      if (targets.has(targetId) || (targetId !== sourceId && rows.has(targetId)))
        throw new Error(`Operational identity collision: ${model}`)
      targets.add(targetId)
      const identity = { model, sourceId, companyId, targetId }
      operationMap.set(key(model, sourceId), identity)
      if (sourceId !== targetId) operationalIdentities.push(identity)
    }
  }
  const mapped = (model: string, id: string, companyId: string): string => {
    if (catalogue.has(model)) return resolve(model, id, companyId)
    const operational = operationMap.get(key(model, id))
    if (operational) {
      if (operational.companyId !== companyId)
        throw new Error(`Cross-company operational reference: ${model}`)
      return operational.targetId
    }
    return id
  }
  const unitPath = (id: string, companyId: string): string => {
    const ids: string[] = []
    const visited = new Set<string>()
    let current: string | null = id
    while (current) {
      if (visited.has(current)) throw new Error('Cyclic unit hierarchy')
      visited.add(current)
      const unit = rowFor('uom.Unit', current)
      ids.unshift(current)
      current = unit.relativeUomId == null ? null : String(unit.relativeUomId)
    }
    // Units written before paths ended in a slash store "a/b"; the projection rewrites them as "a/b/".
    if (String(rowFor('uom.Unit', id).parentPath).replace(/\/?$/u, '/') !== `${ids.join('/')}/`)
      throw new Error('Unit hierarchy and stored path disagree')
    return `${ids.map((unitId) => resolve('uom.Unit', unitId, companyId)).join('/')}/`
  }
  // The original company keeps every ID, so only copies and shared rows can hold a
  // catalogue ID that no longer means what it did. JSON is reviewed only when it
  // carries such an ID as a whole value, key or delimited token (a list, path or query).
  const carriesCatalogueId = idDetector([
    ...Object.values(sourceIds).flat(),
    ...operationalIdentities.map((identity) => identity.sourceId),
  ])
  const pendingReviews: CatalogueProjectionReview[] = []
  const reviewKeys = new Set<string>()
  const review = (model: string, row: Row, field: string, reason: CatalogueProjectionReview['reason']) => {
    const id = JSON.stringify([model, row.id, field, reason])
    if (reviewKeys.has(id)) return
    reviewKeys.add(id)
    pendingReviews.push({ model, sourceId: String(row.id), field, reason })
  }
  const project = (model: string, row: Row, companyId: string): Row => {
    const after = structuredClone(row)
    after.id = mapped(model, String(row.id), companyId)
    if (catalogue.has(model)) after.companyId = companyId
    for (const [field, column] of Object.entries(tables.get(model)!.columns)) {
      const value = row[field]
      if (
        companyId !== identityPlan.originalCompanyId &&
        typeof value === 'string' &&
        /(?:Hash|Digest|Fingerprint)$/.test(field)
      )
        review(model, row, field, 'opaque-hash')
      if (column.base !== 'ref' || !column.target) continue
      if (value == null) {
        if (!column.optional) throw new Error(`Missing required reference: ${model}.${field}`)
        continue
      }
      const target = rowFor(column.target, value)
      if (
        catalogue.has(model) &&
        !catalogue.has(column.target) &&
        tables.get(column.target)?.columns.companyId
      ) {
        review(model, row, field, 'company-reference-on-catalogue')
        continue
      }
      if (
        !catalogue.has(column.target) &&
        tables.get(column.target)?.columns.companyId &&
        target.companyId !== companyId
      )
        throw new Error(`Cross-company typed reference: ${model}.${field}`)
      after[field] = mapped(column.target, String(value), companyId)
    }
    if (model === 'uom.Unit') after.parentPath = unitPath(String(row.id), companyId)
    if (model === 'product.Product') {
      const combination = String(row.combinationKey ?? '')
      if (combination.startsWith('manual:') || combination.startsWith('archived:')) {
        const prefix = combination.slice(0, combination.indexOf(':') + 1)
        if (combination.slice(prefix.length) !== row.id)
          throw new Error('Variant identity marker disagrees with its row')
        after.combinationKey = `${prefix}${String(after.id)}`
      } else if (combination) {
        after.combinationKey = combination
          .split(',')
          .map((id) => resolve('product.AttributeValue', id, companyId))
          .join(',')
      }
    }
    if (
      typeof row.resModel === 'string' &&
      typeof row.resId === 'string' &&
      (catalogue.has(row.resModel) || operationMap.has(key(row.resModel, row.resId)))
    ) {
      rowFor(row.resModel, row.resId)
      after.resId = mapped(row.resModel, row.resId, companyId)
    }
    return after
  }

  const output: CatalogueProjectedRow[] = []
  const affected = new Set(identityPlan.references.map((ref) => ref.model))
  for (const [model, table] of tables) {
    if (
      Object.values(table.columns).some(
        (column) => column.target === 'product.Cost' || column.target === 'stock.Quant',
      )
    )
      affected.add(model)
    if (table.columns.resModel && table.columns.resId) affected.add(model)
  }
  for (const [model, rows] of snapshots) {
    // A JSON-only receipt can refer to a product without having any typed FK.
    // Preserve its bytes and require the owning module to classify the field.
    const json = Object.entries(tables.get(model)!.columns).filter(([, column]) => column.base === 'json')
    for (const row of rows.values()) {
      const owner = typeof row.companyId === 'string' && companies.has(row.companyId) ? row.companyId : null
      const copied = catalogue.has(model) && identityPlan.companyIds.length > 1
      if (!copied && owner === identityPlan.originalCompanyId) continue
      for (const [field] of json)
        if (row[field] != null && carriesCatalogueId(row[field])) review(model, row, field, 'opaque-json')
    }
    if (!catalogue.has(model) && !affected.has(model)) continue
    for (const row of rows.values()) {
      const owners = catalogue.has(model) ? identityPlan.companyIds : [companyOf(row, model)]
      for (const companyId of owners) {
        const after = project(model, row, companyId)
        const clone = catalogue.has(model) && companyId !== identityPlan.originalCompanyId
        if (clone || !same(row, after))
          output.push({
            model,
            sourceId: String(row.id),
            companyId,
            mode: clone ? 'clone' : 'update',
            before: clone ? null : structuredClone(row),
            after,
          })
      }
    }
  }
  pendingReviews.sort((a, b) =>
    compare(
      JSON.stringify([a.model, a.sourceId, a.field, a.reason]),
      JSON.stringify([b.model, b.sourceId, b.field, b.reason]),
    ),
  )
  return { identityPlan, operationalIdentities, rows: output, pendingReviews }
}

/**
 * Settle the `opaque-json`/`opaque-hash` reviews of fields their owner keeps byte for
 * byte. An owner lists a field only after checking that nothing recomputes it from its
 * row or resolves a catalogue ID out of it; company references stay with their policy.
 */
export function preserveCatalogueEvidence(
  projection: CatalogueCompanyProjection,
  evidence: Readonly<Record<string, readonly string[]>>,
): CatalogueCompanyProjection {
  const result = structuredClone(projection)
  result.pendingReviews = result.pendingReviews.filter(
    (review) =>
      review.reason === 'company-reference-on-catalogue' || !evidence[review.model]?.includes(review.field),
  )
  return result
}

/** A queued KetJS job as stored in `ket_job`, read before the catalogue is split. */
export type CatalogueQueuedJob = {
  id: string
  job: string
  state: string
  /** The stored JSON text, or its decoded value. */
  args: unknown
  uniqueKey?: string | null
  companyId?: string | null
  /** The stored JSON list of scope companies, or its decoded value. */
  companies?: unknown
}

/** States a worker can still claim or is running; the rest are terminal. */
const ACTIVE_JOB_STATES = new Set(['available', 'scheduled', 'executing', 'retryable'])

/**
 * Refuse while a queued job outside the original company still names a catalogue or
 * rekeyed cost/quant ID. Its arguments were written against the old IDs and only its
 * handler knows their meaning, so the job is drained before the split, not rewritten.
 * Jobs scoped to the original company keep working: it keeps every ID.
 */
export function assertNoQueuedCatalogueJobs(
  projection: CatalogueCompanyProjection,
  jobs: readonly CatalogueQueuedJob[],
): void {
  const original = projection.identityPlan.originalCompanyId
  const carries = catalogueIdDetector(projection)
  const decode = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  const blocked: string[] = []
  for (const job of jobs) {
    if (!ACTIVE_JOB_STATES.has(job.state)) continue
    const companies = decode(job.companies)
    const scoped =
      job.companyId === original &&
      (companies == null || (Array.isArray(companies) && companies.every((id) => id === original)))
    if (scoped) continue
    // A unique key is usually an ID joined to a purpose by ':', as in `${id}:submit`.
    const key = job.uniqueKey ?? ''
    if (carries(decode(job.args)) || (key !== '' && carries([key, ...key.split(':')])))
      blocked.push(`${job.job} ${job.id}`)
  }
  if (blocked.length)
    throw new Error(
      `Queued jobs name catalogue IDs outside the original company; drain them first: ${blocked
        .sort(compare)
        .slice(0, 20)
        .join(', ')}${blocked.length > 20 ? ` and ${blocked.length - 20} more` : ''}`,
    )
}

/** An owner's decision on its fields: settle what it keeps or rewrites, or refuse. */
export type CatalogueOwnerPolicy = (
  projection: CatalogueCompanyProjection,
  snapshot: Readonly<Record<string, readonly Row[]>>,
) => CatalogueCompanyProjection

/**
 * Run a deployment's owner policies in order and return the only projection an
 * executor may apply. A policy may rewrite projected rows and settle reviews; it may
 * not change the identities or raise reviews of its own. Every review must be
 * settled and no queued job may still name a catalogue ID outside the original company.
 */
export function settleCatalogueCompanyProjection(input: {
  projection: CatalogueCompanyProjection
  snapshot: Readonly<Record<string, readonly Row[]>>
  policies: readonly CatalogueOwnerPolicy[]
  jobs: readonly CatalogueQueuedJob[]
}): CatalogueCompanyProjection {
  const reviewKey = (review: CatalogueProjectionReview) =>
    JSON.stringify([review.model, review.sourceId, review.field, review.reason])
  const identities = (projection: CatalogueCompanyProjection) =>
    JSON.stringify([projection.identityPlan, projection.operationalIdentities])
  let projection = structuredClone(input.projection)
  for (const policy of input.policies) {
    const before = new Set(projection.pendingReviews.map(reviewKey))
    const next = policy(projection, input.snapshot)
    if (identities(next) !== identities(projection))
      throw new Error(`Owner policy changed catalogue identities: ${policy.name || 'anonymous'}`)
    if (next.pendingReviews.some((review) => !before.has(reviewKey(review))))
      throw new Error(`Owner policy raised a review: ${policy.name || 'anonymous'}`)
    projection = next
  }
  if (projection.pendingReviews.length) {
    const named = projection.pendingReviews.map(
      (review) => `${review.model}.${review.field} (${review.reason})`,
    )
    const fields = [...new Set(named)]
    throw new Error(
      `Unsettled catalogue reviews: ${fields.slice(0, 20).join(', ')}${fields.length > 20 ? ` and ${fields.length - 20} more` : ''}`,
    )
  }
  assertNoQueuedCatalogueJobs(projection, input.jobs)
  return projection
}
