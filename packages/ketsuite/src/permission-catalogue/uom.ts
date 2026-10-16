import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    convert: ['operate', 'operate'],
    listUnits: ['read', 'view'],
    lockUnit: ['approve', 'approve', 'uom.domain-policy'],
    savePrecision: ['configure', 'configure', 'uom.configuration-audit'],
    saveUnit: ['configure', 'configure', 'uom.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
