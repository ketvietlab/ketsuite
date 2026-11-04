/** Offline migration tooling; none of these helpers changes application scope or writes tenant data. */
export {
  catalogueIdentityResolver,
  companyCatalogueModels,
  planCatalogueCompanyIdentities,
} from './company-identities.ts'
export type {
  CatalogueCompanyIdentity,
  CatalogueIdentityPlan,
  CatalogueReference,
} from './company-identities.ts'
export { inspectCatalogueCompanyIdentities } from './company-preflight.ts'
export { companyCatalogueModules, sharedCatalogueModules } from './company-catalogue.ts'
export { splitCatalogueByCompany } from './company-split.ts'
export type { CatalogueSplitReport } from './company-split.ts'
export {
  assertNoQueuedCatalogueJobs,
  catalogueIdDetector,
  preserveCatalogueEvidence,
  settleCatalogueCompanyProjection,
  projectCatalogueCompanyRows,
} from './company-projection.ts'
export type {
  CatalogueCompanyProjection,
  CatalogueOwnerPolicy,
  CatalogueProjectedRow,
  CatalogueProjectionReview,
  CatalogueQueuedJob,
} from './company-projection.ts'
