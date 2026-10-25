import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'view'],
  functions: {
    searchInbox: ['read', 'view'],
    countInbox: ['read', 'view'],
    countUnread: ['read', 'view'],
    listInbox: ['read', 'view'],
    listSubtypes: ['read', 'view'],
    markAllInboxRead: ['operate', 'operate'],
    markInboxRead: ['operate', 'operate'],
    saveSubtype: ['configure', 'configure', 'mail.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
