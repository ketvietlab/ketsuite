import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['operate', 'view'],
  functions: {
    mentionCandidates: ['operate', 'operate'],
    follow: ['operate', 'operate'],
    post: ['operate', 'operate'],
    timeline: ['read', 'view'],
    unfollow: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
