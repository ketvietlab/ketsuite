import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'internal/headless',
  bundles: [],
  functions: {},
  exemptions: {
    archiveSavedSearch: ['internal-route', 'backend.trusted-route-worker-or-service'],
    listSavedSearches: ['internal-route', 'backend.trusted-route-worker-or-service'],
    saveSavedSearch: ['internal-route', 'backend.trusted-route-worker-or-service'],
    setDefaultSavedSearch: ['internal-route', 'backend.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
