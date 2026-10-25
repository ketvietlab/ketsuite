import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['operate'],
  functions: {
    notifySubmission: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
