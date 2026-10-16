import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'view'],
  functions: {
    archiveBranch: ['configure', 'configure', 'company.configuration-audit'],
    archiveCompany: ['configure', 'configure', 'company.configuration-audit'],
    getCompany: ['read', 'view'],
    listBranches: ['read', 'view'],
    listCompanies: ['read', 'view'],
    saveBranch: ['configure', 'configure', 'company.configuration-audit'],
    saveCompany: ['configure', 'configure', 'company.configuration-audit'],
  },
  exemptions: {
    contextLabels: ['internal-route', 'company.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
