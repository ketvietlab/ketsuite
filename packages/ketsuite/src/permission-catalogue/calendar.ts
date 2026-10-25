import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    availability: ['operate', 'operate'],
    cancelEvent: ['approve', 'approve', 'calendar.domain-policy'],
    listAgenda: ['read', 'view'],
    saveEvent: ['operate', 'operate'],
    saveTag: ['configure', 'configure', 'calendar.configuration-audit'],
  },
  exemptions: {
    rsvp: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
