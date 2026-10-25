import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['view'],
  functions: {
    // Pure URL computation from client-supplied filter state — no model read,
    // no write, nothing revealed that the caller did not already send. The
    // same floor as `partner.countPartners`/`listPartners`'s own `view` risk.
    applyFilter: ['read', 'view'],
  },
  exemptions: {},
} satisfies CatalogueSource
