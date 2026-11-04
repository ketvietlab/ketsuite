import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['operate'],
  functions: {
    notifySubmission: ['operate', 'operate'],
  },
  exemptions: {
    // Delivery facts only, read by the Studio submission queue and detail after they check
    // website_form.listSubmissions or website_form.readSubmission for the same rows.
    noticeStates: ['internal-route', 'website_backend.submission-queue'],
  },
} satisfies CatalogueSource
