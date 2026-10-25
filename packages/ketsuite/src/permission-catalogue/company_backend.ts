import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['view', 'operate'],
  functions: {
    // The bar reads what the reader may already read, and writes only their
    // own saved searches.
    applySearchFilter: ['read', 'view'],
    saveSearchFavorite: ['operate', 'operate'],
    deleteSearchFavorite: ['operate', 'operate'],
    setDefaultSearchFavorite: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
