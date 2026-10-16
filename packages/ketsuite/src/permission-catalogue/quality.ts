import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    createRequirement: ['configure', 'configure', 'quality.configuration-audit'],
    getCheck: ['read', 'view'],
    saveTemplate: ['configure', 'configure', 'quality.configuration-audit'],
    submit: ['approve', 'approve', 'quality.domain-policy'],
    uploadPhoto: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
