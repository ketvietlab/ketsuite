import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'view'],
  functions: {
    'sale.createQuotation': ['configure', 'configure', 'crm_sale.configuration-audit'],
    'sale.listQuotableProducts': ['read', 'view'],
    'sale.listQuotations': ['read', 'view'],
  },
  exemptions: {
    // `exposure: 'internal'`, behind the sales command route. A revision is checked against
    // `crm_sale.sale.createQuotation`; an acceptance's history line follows `sale.confirmOrder` run as
    // the user; quotations follow a `crm.case.merge` the user ran. Each checks the user reads the record.
    'sale.reviseQuotation': ['internal-route', 'crm_sale.trusted-route-worker-or-service'],
    'sale.recordQuotationStep': ['internal-route', 'crm_sale.trusted-route-worker-or-service'],
    'sale.followMerge': ['internal-route', 'crm_sale.trusted-route-worker-or-service'],
    // Attaching a quotation written in Sales is checked against `crm_sale.sale.createQuotation` and
    // checks the user may change the record; the policy is checked against `crm.stage.save`.
    'sale.attachQuotation': ['internal-route', 'crm_sale.trusted-route-worker-or-service'],
    'sale.saveQuotationPolicy': ['internal-route', 'crm_sale.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
