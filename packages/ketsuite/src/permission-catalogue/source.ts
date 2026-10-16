import type { PermissionExemptionReason, PermissionPosture, PermissionRisk } from '@ketvietlab/ketjs'

/**
 * One public KetSuite module's permission declarations, as `permission-catalogue.ts`
 * expands them: each capability becomes a bundle `<module>.<capability>`, and
 * each function names its risk, its bundles and, optionally, the policy that
 * stands in for a bundle.
 */
export type CatalogueSource = {
  posture: PermissionPosture
  bundles: string[]
  functions: Record<string, [PermissionRisk, string | string[], string?]>
  exemptions: Record<string, [PermissionExemptionReason, string]>
}
