import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['operate', 'view'],
  functions: {
    indexStatus: ['read', 'view'],
    reindexSite: ['operate', 'operate'],
  },
  exemptions: {
    searchIndexed: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
