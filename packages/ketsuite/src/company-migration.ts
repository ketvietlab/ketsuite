/**
 * Offline tooling and owner policies for splitting the catalogue by company. Kept out of
 * the package root so a running deployment never loads migration code.
 */
import { posCatalogueEvidence } from './modules/pos/company-catalogue-evidence.ts'
import { preserveCatalogueEvidence } from './modules/product/company-migration.ts'
import type { CatalogueCompanyProjection, CatalogueOwnerPolicy } from './modules/product/company-migration.ts'
import { saleCatalogueEvidence } from './modules/sale/company-catalogue-evidence.ts'
import { stockStaffChannelCatalogueEvidence } from './modules/stock_staff_channel/company-catalogue-evidence.ts'
import { projectCompanyCatalogueWebsiteCards } from './modules/website_catalog/company-catalogue-projection.ts'

export * from './modules/product/company-migration.ts'
export { posCatalogueEvidence } from './modules/pos/company-catalogue-evidence.ts'
export { saleCatalogueEvidence } from './modules/sale/company-catalogue-evidence.ts'
export { stockStaffChannelCatalogueEvidence } from './modules/stock_staff_channel/company-catalogue-evidence.ts'
export { projectCompanyCatalogueWebsiteCards } from './modules/website_catalog/company-catalogue-projection.ts'

/** Keep the sale, POS and staff-scan evidence the public modules declared. */
export function preservePublicCatalogueEvidence(
  projection: CatalogueCompanyProjection,
): CatalogueCompanyProjection {
  return preserveCatalogueEvidence(projection, {
    ...saleCatalogueEvidence,
    ...posCatalogueEvidence,
    ...stockStaffChannelCatalogueEvidence,
  })
}

/**
 * Policies of the public modules. A deployment appends the policies of its own modules
 * and runs them all through `settleCatalogueCompanyProjection`.
 */
export const publicCatalogueOwnerPolicies: readonly CatalogueOwnerPolicy[] = [
  projectCompanyCatalogueWebsiteCards,
  preservePublicCatalogueEvidence,
]
