import type { CatalogueSource } from './source.ts'
export const permissions = {
  posture: 'permission-bearing',
  bundles: ['view', 'operate', 'configure'],
  functions: {
    setTemplateActive: ['configure', 'configure', 'sale_template.configuration-audit'],
    createQuotation: ['operate', 'operate'],
    listChoices: ['read', 'view'],
    searchProducts: ['read', 'view'],
    sectionChoices: ['read', 'operate'],
    listTemplates: ['read', 'view'],
    getTemplate: ['read', 'view'],
    getSetup: ['read', 'view'],
    previewSection: ['read', 'operate'],
    saveSection: ['operate', 'operate'],
    addSection: ['operate', 'operate'],
    applyQuotation: ['operate', 'operate'],
    saveTemplate: ['configure', 'configure', 'sale_template.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
