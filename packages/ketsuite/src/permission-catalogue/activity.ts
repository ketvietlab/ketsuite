import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    cancel: ['approve', 'approve', 'activity.domain-policy'],
    complete: ['approve', 'approve', 'activity.domain-policy'],
    countDue: ['read', 'view'],
    listMy: ['read', 'view'],
    listPlans: ['read', 'view'],
    listTypes: ['read', 'view'],
    reschedule: ['operate', 'operate'],
    savePlan: ['configure', 'configure', 'activity.configuration-audit'],
    saveType: ['configure', 'configure', 'activity.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
