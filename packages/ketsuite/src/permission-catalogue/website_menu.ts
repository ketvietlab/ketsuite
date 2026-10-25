import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'view'],
  functions: {
    addMenuItem: ['configure', 'configure', 'website.configuration-audit'],
    listMenu: ['read', 'view'],
    menuState: ['read', 'view'],
    preflightMenu: ['read', 'view'],
    moveMenuItem: ['configure', 'configure', 'website.configuration-audit'],
    removeMenuItem: ['configure', 'configure', 'website.configuration-audit'],
    saveMenu: ['configure', 'configure', 'website.configuration-audit'],
    snapshotMenu: ['configure', 'configure', 'website.configuration-audit'],
  },
  exemptions: {
    publicMenu: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
