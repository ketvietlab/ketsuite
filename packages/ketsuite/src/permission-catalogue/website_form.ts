import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'security', 'sensitive', 'view'],
  functions: {
    archiveForm: ['configure', 'configure', 'website.configuration-audit'],
    countSubmissions: ['read', 'view'],
    exportSubmissions: ['sensitive', 'sensitive', 'website.sensitive-data'],
    formHistory: ['read', 'view'],
    holdSubmission: ['operate', 'operate'],
    listDestinations: ['read', 'view'],
    listForms: ['read', 'view'],
    listSubmissionAudit: ['sensitive', 'sensitive', 'website.sensitive-data'],
    listSubmissions: ['read', 'view'],
    purgeSubmissions: ['security', 'security', 'website.security-audit'],
    readSubmission: ['sensitive', 'sensitive', 'website.sensitive-data'],
    retryDelivery: ['operate', 'operate'],
    saveForm: ['configure', 'configure', 'website.configuration-audit'],
    validateSubmission: ['read', 'view'],
  },
  exemptions: {
    getForm: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    // What a public page draws for a form section: the fields of an active form of that site.
    publicForm: ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
    submitForm: ['internal-route', 'website_form.public-submit-route'],
    // Form name and time only, read by the public receipt page and the Studio receipt screen.
    submissionReceipt: ['internal-route', 'website_form.public-submit-route'],
  },
} satisfies CatalogueSource
