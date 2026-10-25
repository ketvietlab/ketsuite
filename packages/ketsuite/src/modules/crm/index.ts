import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
import { jobFunctions, jobs } from './jobs.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'crm',
  version: '0.1.0',
  depends: ['company', 'partner', 'user', 'mail', 'activity', 'calendar'],
  // The case modal reads quotations, orders, products and warehouses when those modules are installed.
  optional: ['crm_sale', 'product', 'sale', 'stock'],
  title: 'CRM',
  summary: 'Sales pipeline for leads and opportunities.',
  category: 'Sales',
  models,
  functions: { ...functions, ...jobFunctions },
  jobs,
  messages,
})

export * from './types.ts'
export { caseReadEffects, caseWriteEffects, functions, logInteraction } from './functions/index.ts'
export type { InteractionInput } from './functions/index.ts'
export {
  addCaseMessage,
  addTimeline,
  activeStage,
  actorRequired,
  applyCaseScore,
  audienceHolds,
  canAssignCase,
  canEditCase,
  canReadCase,
  caseAudience,
  caseDetail,
  closedAtFor,
  commandKey,
  crmActivityType,
  duplicateCases,
  ensureCrmDefaults,
  firstStage,
  gamificationProfile,
  invalid,
  issue,
  liveSuperuser,
  n,
  normalized,
  now,
  ownedKinds,
  ownsKind,
  pipelineSummary,
  reassignCase,
  rescheduleCaseActivity,
  saveCase,
  seededId,
  serializeCaseList,
  stageKinds,
  visibleCases,
} from './operations.ts'
export type { CaseAccessScope, CaseAction, CaseAudience } from './operations.ts'
