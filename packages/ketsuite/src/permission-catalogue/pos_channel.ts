import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: [],
  functions: {},
  exemptions: {
    claimSyncCommand: ['internal-route', 'pos_channel.trusted-route-worker-or-service'],
    completeSyncCommand: ['internal-route', 'pos_channel.trusted-route-worker-or-service'],
    getSyncCommand: ['internal-route', 'pos_channel.trusted-route-worker-or-service'],
    listDeviceSyncCommands: ['internal-route', 'pos_channel.trusted-route-worker-or-service'],
    priceBook: ['internal-route', 'pos_channel.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
