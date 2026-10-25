import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'projection/bridge',
  bundles: ['configure', 'view'],
  functions: {
    passwordResetTemplate: ['read', 'view'],
    savePasswordResetTemplate: ['configure', 'configure', 'website_customer_mail.configuration-audit'],
  },
  exemptions: {
    // Only the customer API's forgot-password route, after it recorded the reset.
    mailPasswordReset: ['internal-route', 'channel_api.customer-password-forgot-route'],
  },
} satisfies CatalogueSource
