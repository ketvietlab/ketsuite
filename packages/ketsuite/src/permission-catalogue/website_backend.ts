import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['view'],
  functions: {
    studioContext: ['read', 'view'],
  },
  exemptions: {},
} satisfies CatalogueSource
