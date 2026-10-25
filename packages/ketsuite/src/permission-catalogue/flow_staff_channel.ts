import type { CatalogueSource } from './source.ts'

// Routes only, no functions of its own: every read and command reaches Flow
// through `ctx.call`, which is what makes project membership apply to the
// phone without the rule being written a second time (FLW-DEC-019).
export const permissions = {
  posture: 'projection/bridge',
  bundles: [],
  functions: {},
  exemptions: {},
} satisfies CatalogueSource
