import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['configure', 'operate', 'sensitive'],
  functions: {
    'calendar.mine': ['operate', 'operate'],
    'clock.mine': ['operate', 'operate'],
    'correction.manageDecision': ['configure', 'configure', 'attendance.configuration-audit'],
    'correction.request': ['operate', 'operate'],
    'credential.manageOptions': ['sensitive', 'sensitive', 'attendance.sensitive-data'],
    'overtime.manageDecision': ['configure', 'configure', 'attendance.configuration-audit'],
    'period.export': ['sensitive', 'sensitive', 'attendance.sensitive-data'],
    'period.manageClose': ['configure', 'configure', 'attendance.configuration-audit'],
    'period.manageReopen': ['configure', 'configure', 'attendance.configuration-audit'],
    'period.report': ['sensitive', 'sensitive', 'attendance.sensitive-data'],
    'policy.save': ['configure', 'configure', 'attendance.configuration-audit'],
    'punch.self': ['operate', 'operate'],
    'session.mine': ['operate', 'operate'],
  },
  exemptions: {
    'credential.managePin': ['internal-route', 'attendance.trusted-route-worker-or-service'],
    'credential.manageQr': ['internal-route', 'attendance.trusted-route-worker-or-service'],
    'kiosk.manageIssue': ['internal-route', 'attendance.trusted-route-worker-or-service'],
    'punch.kiosk': ['anonymous', 'declared-public-or-cryptographic-realm-boundary'],
  },
} satisfies CatalogueSource
