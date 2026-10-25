import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['approve', 'configure', 'operate', 'sensitive', 'view'],
  functions: {
    receiveReply: ['sensitive', 'sensitive', 'mail_inbound.sensitive-data'],
    createReplyToken: ['operate', 'operate'],
    saveAlias: ['configure', 'configure', 'mail_inbound.configuration-audit'],
    listEvents: ['read', 'view'],
    requestRetention: ['approve', 'approve', 'mail_inbound.domain-policy'],
  },
  exemptions: {},
} satisfies CatalogueSource
