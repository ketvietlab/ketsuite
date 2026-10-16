import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    applySearchFilter: ['read', 'view'],
    deleteSearchFavorite: ['operate', 'operate'],
    getFolioBilling: ['read', 'view'],
    invoiceFolio: ['approve', 'approve', 'hospitality_billing.domain-policy'],
    listChargeRules: ['read', 'view'],
    queueClosedFolios: ['operate', 'operate'],
    recordFolioPayment: ['operate', 'operate'],
    saveChargeRule: ['configure', 'configure', 'hospitality_billing.configuration-audit'],
    saveSearchFavorite: ['operate', 'operate'],
    setDefaultSearchFavorite: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
