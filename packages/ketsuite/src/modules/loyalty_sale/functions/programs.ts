import { defineFn } from '@ketvietlab/ketjs'
import { getProgram, listPrograms, saveProgram, setProgramActive, generateCoupons } from '../programs.ts'
export const programReadEffects = [
  'loyalty.Program',
  'loyalty.ProgramPricelist',
  'loyalty.Rule',
  'loyalty.RuleProduct',
  'loyalty.RuleCategory',
  'loyalty.RuleTag',
  'loyalty.Reward',
  'loyalty.RewardProduct',
  'loyalty.Wallet',
  'loyalty.Application',
].map((model) => 'read:' + model)
const writeEffects = [
  ...programReadEffects,
  'read:company.Company',
  'read:product.Product',
  'read:product.Template',
  'read:product.Category',
  'read:product.Tag',
  'read:pricing.Pricelist',
  'read:loyalty.ProgramNamespace',
  ...[
    'loyalty.ProgramNamespace',
    'loyalty.Program',
    'loyalty.ProgramPricelist',
    'loyalty.Rule',
    'loyalty.RuleProduct',
    'loyalty.RuleCategory',
    'loyalty.RuleTag',
    'loyalty.Reward',
    'loyalty.RewardProduct',
  ].map((model) => 'write:' + model),
]
const output = { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' } as const
export const programFunctions = {
  generateCoupons: defineFn({
    idempotent: true,
    input: { id: 'id', expectedRevision: 'int', count: 'int', partnerId: 'id?', expiresOn: 'text?' },
    effects: [
      ...writeEffects,
      'read:partner.Partner',
      'write:loyalty.Wallet',
      'read:loyalty.LedgerEntry',
      'write:loyalty.LedgerEntry',
    ],
    handler: generateCoupons,
  }),
  getProgram: defineFn({ input: { id: 'id' }, effects: programReadEffects, handler: getProgram }),
  listPrograms: defineFn({
    input: { search: 'text?', active: 'bool?', programType: 'text?', page: 'int?', pageSize: 'int?' },
    // A gift's name comes from its product.
    effects: [...programReadEffects, 'read:product.Product', 'read:product.Template'],
    handler: listPrograms,
  }),
  saveProgram: defineFn({
    idempotent: true,
    input: { id: 'id?', expectedRevision: 'int?', values: 'json' },
    output,
    effects: writeEffects,
    handler: saveProgram,
  }),
  setProgramActive: defineFn({
    idempotent: true,
    input: { id: 'id', expectedRevision: 'int', active: 'bool' },
    output,
    effects: writeEffects,
    handler: setProgramActive,
  }),
}
