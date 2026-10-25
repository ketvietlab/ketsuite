import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'session/device',
  bundles: ['configure', 'security', 'sensitive'],
  functions: {
    archiveProvider: ['security', 'security', 'oauth.security-audit'],
    getProvider: ['sensitive', 'sensitive', 'oauth.sensitive-data'],
    linkIdentity: ['security', 'security', 'oauth.security-audit'],
    listIdentities: ['sensitive', 'sensitive', 'oauth.sensitive-data'],
    listProviders: ['sensitive', 'sensitive', 'oauth.sensitive-data'],
    manageOptions: ['configure', 'configure', 'oauth.configuration-audit'],
    saveProvider: ['security', 'security', 'oauth.security-audit'],
    unlinkIdentity: ['security', 'security', 'oauth.security-audit'],
  },
  exemptions: {
    beginTransaction: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    claimTransaction: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    myIdentities: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    providerForLogin: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    publicProviders: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    resolveLogin: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
