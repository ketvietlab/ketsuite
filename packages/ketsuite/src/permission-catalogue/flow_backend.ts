import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['view', 'operate'],
  functions: {
    applySearchFilter: ['read', 'view'],
    saveSearchFavorite: ['operate', 'operate'],
    deleteSearchFavorite: ['operate', 'operate'],
    setDefaultSearchFavorite: ['operate', 'operate'],
  },
  exemptions: {
    // `exposure: 'internal'`: the generic /_ket/fn/ path refuses these outright.
    // Live Doc calls them through the route that has already run its own record
    // permission check — see documentRoutes and the DocumentOwner seam.
    'sync.commitContent': ['internal-route', 'flow_backend.trusted-route-worker-or-service'],
    'sync.commitEpicContent': ['internal-route', 'flow_backend.trusted-route-worker-or-service'],
    'sync.commitPageContent': ['internal-route', 'flow_backend.trusted-route-worker-or-service'],
    'sync.commitProjectContent': ['internal-route', 'flow_backend.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
