import type { Row } from '@ketvietlab/ketjs'
import { catalogueIdDetector, catalogueIdentityResolver } from '../product/company-migration.ts'
import type { CatalogueCompanyProjection } from '../product/company-migration.ts'

const productCard = 'website_catalog.product_card'

/** Live layouts a storefront renders; a product card in them names its template. */
const layoutFields: Readonly<Record<string, readonly string[]>> = {
  'website_catalog.Binding': ['contentLayout', 'overrides'],
  'website_catalog.Template': ['layout'],
  'website_catalog.Category': ['layout'],
  'website.Page': ['layout'],
  'website.EntryRevision': ['layout'],
}

const key = (...parts: string[]): string => JSON.stringify(parts)
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Point product cards of copied companies at their own template copy. A card is
 * resolved through `Binding { siteId, productId }` when the page renders, so a card
 * keeping the original ID would vanish from the copied company's storefront. A
 * published set only freezes revision IDs, so its content hash is unaffected.
 * A field stays pending when anything besides its cards still names a catalogue ID.
 */
export function projectCompanyCatalogueWebsiteCards(
  projection: CatalogueCompanyProjection,
  snapshot: Readonly<Record<string, readonly Row[]>>,
): CatalogueCompanyProjection {
  const result = structuredClone(projection)
  const { originalCompanyId, companyIds } = projection.identityPlan
  const resolve = catalogueIdentityResolver(projection.identityPlan)
  const carriesCatalogueId = catalogueIdDetector(projection)
  const templates = new Set(
    projection.identityPlan.identities
      .filter((identity) => identity.model === 'product.Template')
      .map((identity) => identity.sourceId),
  )
  const rewrite = (value: unknown, companyId: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => rewrite(item, companyId))
    if (!value || typeof value !== 'object') return value
    const node = Object.fromEntries(
      Object.entries(value).map(([field, item]) => [field, rewrite(item, companyId)]),
    ) as Row
    const settings = node.settings as Row | undefined
    if (
      node.type === productCard &&
      typeof settings?.productId === 'string' &&
      templates.has(settings.productId)
    )
      node.settings = { ...settings, productId: resolve('product.Template', settings.productId, companyId) }
    return node
  }
  const changes = new Map(result.rows.map((row) => [key(row.model, row.sourceId, row.companyId), row]))
  const settled = new Set<string>()
  for (const [model, fields] of Object.entries(layoutFields))
    for (const row of snapshot[model] ?? []) {
      const companyId = String(row.companyId)
      if (companyId === originalCompanyId || !companyIds.includes(companyId)) continue
      const held = changes.get(key(model, String(row.id), companyId))
      const after = held ? held.after : structuredClone(row)
      let changed = false
      for (const field of fields) {
        if (after[field] == null) continue
        const value = rewrite(after[field], companyId)
        if (!carriesCatalogueId(value)) settled.add(key(model, String(row.id), field))
        if (same(value, after[field])) continue
        after[field] = value
        changed = true
      }
      if (changed && !held)
        result.rows.push({
          model,
          sourceId: String(row.id),
          companyId,
          mode: 'update',
          before: structuredClone(row),
          after,
        })
    }
  result.pendingReviews = result.pendingReviews.filter(
    (review) =>
      !(review.reason === 'opaque-json' && settled.has(key(review.model, review.sourceId, review.field))),
  )
  return result
}
