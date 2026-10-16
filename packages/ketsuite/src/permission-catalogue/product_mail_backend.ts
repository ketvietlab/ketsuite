import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['approve', 'operate'],
  functions: {
    follow: ['operate', 'operate'],
    post: ['approve', 'approve', 'product_mail_backend.domain-policy'],
    timeline: ['operate', 'operate'],
    unfollow: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
