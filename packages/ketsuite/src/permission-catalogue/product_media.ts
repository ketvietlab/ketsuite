import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'view'],
  functions: {
    attachMedia: ['operate', 'operate'],
    getMediaAttachment: ['read', 'view'],
    listMedia: ['read', 'view'],
    listMediaByProducts: ['read', 'view'],
    listPrimaryMedia: ['read', 'view'],
    removeMedia: ['operate', 'operate'],
    reorderMedia: ['operate', 'operate'],
    setPrimary: ['configure', 'configure', 'product_media.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
