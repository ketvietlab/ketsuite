import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'sensitive', 'view'],
  functions: {
    cancel: ['approve', 'approve', 'mail_transport.domain-policy'],
    searchOutbox: ['read', 'view'],
    retryNotification: ['operate', 'operate'],
    listOutbox: ['read', 'view'],
    queueTemplate: ['operate', 'operate'],
    recordProviderEvent: ['sensitive', 'sensitive', 'mail_transport.sensitive-data'],
    retry: ['operate', 'operate'],
    saveTemplate: ['configure', 'configure', 'mail_transport.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
