import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'view'],
  functions: {
    archivePartner: ['configure', 'configure', 'partner.configuration-audit'],
    archivePartners: ['configure', 'configure', 'partner.configuration-audit'],
    normalizePartnerPhones: ['configure', 'configure', 'partner.configuration-audit'],
    countPartners: ['read', 'view'],
    getPartner: ['read', 'view'],
    getTerms: ['read', 'view'],
    grantRole: ['configure', 'configure', 'partner.configuration-audit'],
    listAddresses: ['read', 'view'],
    listPartners: ['read', 'view'],
    revokeRole: ['configure', 'configure', 'partner.configuration-audit'],
    saveAddress: ['configure', 'configure', 'partner.configuration-audit'],
    savePartner: ['configure', 'configure', 'partner.configuration-audit'],
    saveTerms: ['configure', 'configure', 'partner.configuration-audit'],
    snapshotAddress: ['operate', 'operate'],
  },
  exemptions: {},
} satisfies CatalogueSource
