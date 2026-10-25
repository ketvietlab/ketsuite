import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'view'],
  functions: {
    listPricelistItems: ['read', 'view'],
    listPricelists: ['read', 'view'],
    priceFor: ['operate', 'operate'],
    savePricelist: ['configure', 'configure', 'pricing.configuration-audit'],
    savePricelistItem: ['configure', 'configure', 'pricing.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
