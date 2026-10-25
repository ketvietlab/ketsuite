import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'operate', 'view'],
  functions: {
    availableCatalogs: ['operate', 'operate'],
    catalogStatus: ['operate', 'operate'],
    format: ['operate', 'operate'],
    listCountries: ['read', 'view'],
    listDivisionChildren: ['read', 'view'],
    resolveDivisionPath: ['operate', 'operate'],
    snapshot: ['operate', 'operate'],
    validate: ['approve', 'approve', 'address.domain-policy'],
  },
  exemptions: {
    installCatalog: ['internal-route', 'address.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
