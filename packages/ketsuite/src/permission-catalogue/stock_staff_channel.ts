import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['approve', 'configure', 'operate', 'view'],
  functions: {
    claimCountSession: ['operate', 'operate'],
    claimPicking: ['operate', 'operate'],
    completeExecution: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    completeGuidedPicking: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    completeReturnExecution: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    createCountSession: ['configure', 'configure', 'stock_staff_channel.configuration-audit'],
    getCountContext: ['read', 'view'],
    getScanContext: ['read', 'view'],
    listActiveClaims: ['read', 'view'],
    listCountSessions: ['read', 'view'],
    recordCountLine: ['operate', 'operate'],
    releasePicking: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    resumeCountAttempt: ['operate', 'operate'],
    startScanSession: ['operate', 'operate'],
    submitCountAttempt: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    submitScanEvent: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
    transitionScanSession: ['approve', 'approve', 'stock_staff_channel.domain-policy'],
  },
  exemptions: {},
} satisfies CatalogueSource
