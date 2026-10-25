import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['view', 'operate'],
  functions: {
    applySearchFilter: ['read', 'view'],
    applyAttributeSearchFilter: ['read', 'view'],
    searchUnits: ['read', 'view'],
    unitContext: ['read', 'view'],
    saveSearchFavorite: ['operate', 'operate'],
    deleteSearchFavorite: ['operate', 'operate'],
    searchTemplates: ['read', 'view'],
    setDefaultSearchFavorite: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
