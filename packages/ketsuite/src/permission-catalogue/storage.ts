import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['operate', 'view'],
  functions: {
    createAttachment: ['operate', 'operate'],
    getAttachment: ['read', 'view'],
    listAttachments: ['read', 'view'],
    removeAttachment: ['operate', 'operate'],
    requestRender: ['operate', 'operate'],
    requestSweep: ['operate', 'operate'],
  },
  exemptions: {
    getPublicAttachment: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
