import { AUTHORIZATION_READ_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { reject } from '../../hospitality_core/functions/command.ts'
import type { FnSpec, JobSpec } from '@ketvietlab/ketjs'
import { guardedOperationalFunctions } from '../../hospitality_core/functions/operational-commands.ts'
import { GUARANTEE_READS } from '../../hospitality_core/functions/guarantee-source.ts'
import {
  nightAuditFunctions,
  nightAuditJobs,
  requestNightAuditHandler,
} from '../../hospitality_core/night-audit.ts'

// The financial module owns the worker that reads ledger evidence. Core stays independently installable.
const source = nightAuditFunctions.requestNightAudit!
const request = guardedOperationalFunctions({
  requestNightAudit: {
    ...source,
    effects: source.effects?.map((effect) =>
      effect === 'enqueue:hospitality_core.nightAudit' ? 'enqueue:hospitality_billing.nightAudit' : effect,
    ),
    handler: (ctx, args) => requestNightAuditHandler(ctx, args, 'hospitality_billing.nightAudit'),
  },
}).requestNightAudit!
export const billingAuditFunctions: Record<string, FnSpec> = {
  requestNightAudit: {
    ...request,
    effects: [...(request.effects ?? []), ...AUTHORIZATION_READ_EFFECTS],
    handler: async (ctx, args) => {
      if (ctx.actor) {
        const keys = await effectiveFunctionKeys(ctx, ctx.actor)
        if (keys !== null && !keys.includes('hospitality_core.requestNightAudit'))
          reject('auditDate', 'audit_authority')
      }
      return request.handler(ctx, args)
    },
  },
}
export const billingAuditJobs: Record<string, JobSpec> = {
  nightAudit: {
    ...nightAuditJobs.nightAudit!,
    effects: [...new Set([...(nightAuditJobs.nightAudit!.effects ?? []), ...GUARANTEE_READS])],
  },
}
