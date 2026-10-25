import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: [],
  functions: {},
  exemptions: {
    // `exposure: 'internal'`: the generic /_ket/fn/ path refuses it. The sales read route checks the
    // permission of the screen it reads (the same one the screen's page needs), then calls it; every
    // record in it has passed `caseAudience`.
    'sales.read': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    // The record list's page and its export, behind the routes that check `crm.case.list` first.
    'sales.search': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    'sales.export': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    // An activity's new day, behind the command route that checks `crm.activity.cancel` first; the
    // function itself checks the record is the user's to change.
    'sales.rescheduleActivity': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    // A record's email and its retry, behind the command route that checks `crm.case.addMessage`
    // first; each checks the record is the user's to change.
    'sales.sendEmail': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    'sales.retryEmail': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    // A record's quotation sent, behind the command route that checks `sale.sendQuotation` (and
    // `crm.case.addMessage` for an email) first; it checks the record is the user's to change and
    // applies the sale's own sending rule.
    'sales.sendQuotation': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    'sales.saveImportPreview': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
    'sales.importPreview': ['internal-route', 'crm_backend.trusted-route-worker-or-service'],
  },
} satisfies CatalogueSource
