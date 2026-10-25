import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'manage-company', 'operate', 'view'],
  functions: {
    cancel: ['approve', 'approve', 'activity.domain-policy'],
    complete: ['approve', 'approve', 'activity.domain-policy'],
    countDue: ['read', 'view'],
    searchMine: ['read', 'view'],
    listMy: ['read', 'view'],
    listPlans: ['read', 'view'],
    listTypes: ['read', 'view'],
    reassign: ['approve', 'approve', 'activity.domain-policy'],
    'scope.company': ['approve', 'manage-company', 'activity.domain-policy'],
    reschedule: ['operate', 'operate'],
    savePlan: ['configure', 'configure', 'activity.configuration-audit'],
    saveType: ['configure', 'configure', 'activity.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
