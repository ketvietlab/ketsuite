import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: [],
  functions: {},
  exemptions: {
    // Both are `exposure: 'internal'`: the generic function path refuses them.
    // The document owner's own route resolves the record and runs its read or
    // write check first, then calls these — the same arrangement flow_backend's
    // four commit functions use.
    'sync.resolveSnapshotKey': ['internal-route', 'livedoc.trusted-route-worker-or-service'],
    'sync.viewer': ['internal-route', 'livedoc.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
