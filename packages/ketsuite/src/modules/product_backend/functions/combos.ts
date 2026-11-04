import { defineFn } from '@ketvietlab/ketjs'
import {
  COMBO_READ_EFFECTS,
  COMBO_CONTEXT_EFFECTS,
  searchCombosHandler,
  comboContextHandler,
} from '../combos/read.ts'
export const comboFunctions = {
  searchCombos: defineFn({
    input: { href: 'text?', pageSize: 'int?', q: 'text?', page: 'int?' },
    output: {
      query: 'json',
      rows: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      counts: 'json',
      isEmpty: 'bool',
    },
    effects: COMBO_READ_EFFECTS,
    handler: searchCombosHandler,
  }),
  comboContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: COMBO_CONTEXT_EFFECTS,
    handler: comboContextHandler,
  }),
}
