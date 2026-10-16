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
  exemptions: {},
} satisfies CatalogueSource
