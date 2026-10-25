import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['view', 'configure'],
  functions: {
    listBindings: ['read', 'view'],
    getBinding: ['read', 'view'],
    getTemplate: ['read', 'view'],
    getBuilder: ['read', 'view'],
    listCategories: ['read', 'view'],
    getCategory: ['read', 'view'],
    productCandidates: ['read', 'view'],
    previewCategory: ['read', 'view'],
    addProduct: ['configure', 'configure', 'website_catalog.configuration-audit'],
    saveBinding: ['configure', 'configure', 'website_catalog.configuration-audit'],
    removeBinding: ['configure', 'configure', 'website_catalog.configuration-audit'],
    saveBuilder: ['configure', 'configure', 'website_catalog.configuration-audit'],
    saveCategory: ['configure', 'configure', 'website_catalog.configuration-audit'],
    archiveCategory: ['configure', 'configure', 'website_catalog.configuration-audit'],
  },
  exemptions: {
    saveMenu: ['internal-route', 'Studio validates the menu owner grant before calling this bridge.'],
    sitemapEntries: ['internal-route', 'The sitemap resolves the active site from its host.'],
    resolveRedirect: ['anonymous', 'Only visible live stable targets may redirect.'],
    searchIndexed: ['anonymous', 'Live exposed Product projection and native CMS search.'],
    tagMedia: [
      'internal-route',
      'Trusted Product media migration; validates owner and bumps source revision.',
    ],
    importTemplate: ['internal-route', 'Trusted migration with scoped ownership and CAS.'],
    importProductContent: [
      'internal-route',
      'Trusted migration of website editorial content with ownership and CAS.',
    ],
    importCategoryPresentation: [
      'internal-route',
      'Trusted migration of website listing presentation with CAS.',
    ],
    createProduct: [
      'internal-route',
      'Trusted Studio bridge requires both product and website write grants.',
    ],
    getSource: ['internal-route', 'Studio checks product owner grants before calling this projection.'],
    stageImage: ['internal-route', 'Trusted image upload route; ownership and website grant checked.'],
    completeImage: ['internal-route', 'Trusted image upload completion after byte validation.'],
    imageForReader: ['internal-route', 'Trusted file delivery route; public or actor-owned lease only.'],
    getEntryByPath: ['anonymous', 'Published catalog projection with CMS fallback.'],
    publicProduct: ['anonymous', 'Active exposed site-bound products only.'],
    cardData: ['anonymous', 'Active exposed site-bound product card projection only.'],
    publicList: ['anonymous', 'Active exposed site-bound products only.'],
    categoryProducts: ['anonymous', 'Visible ancestry and exposed site-bound products only.'],
  },
} satisfies CatalogueSource
