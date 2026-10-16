import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'view'],
  functions: {
    getEntrySeo: ['read', 'view'],
    saveEntrySeo: ['configure', 'configure', 'website.configuration-audit'],
  },
  exemptions: {
    sitemapEntries: ['internal-route', 'website_seo.public-sitemap-route'],
  },
} satisfies CatalogueSource
