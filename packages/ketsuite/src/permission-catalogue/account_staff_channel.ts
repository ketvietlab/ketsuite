import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['approve', 'operate', 'view'],
  functions: {
    beginInvoiceCommand: ['operate', 'operate'],
    completeInvoiceCommand: ['approve', 'approve', 'account_staff_channel.domain-policy'],
    getInvoiceCommand: ['read', 'view'],
  },
  exemptions: {},
} satisfies CatalogueSource
