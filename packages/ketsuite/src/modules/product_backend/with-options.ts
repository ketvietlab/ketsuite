import productBackend from './index.ts'
import { productWorkspaceContextWith } from './modal/product-workspace-context.ts'

export type ProductBackendOptions = {
  /** Three inventory modes on one field; existing serial records remain readable. */
  combinedInventoryTracking?: boolean
  /** A packaging grid saved with the product, including variant-specific eligibility. */
  variantPackagings?: boolean
}

/** Deployment-owned presentation choices; domain capabilities and permissions are unchanged. */
export function productBackendWith(options: ProductBackendOptions = {}) {
  if (!options.combinedInventoryTracking && !options.variantPackagings) return productBackend
  return {
    ...productBackend,
    routes: {
      ...productBackend.routes,
      '/admin/product/templates/{id}/context': productWorkspaceContextWith(options),
    },
  }
}
