import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { readStockSearch, SEARCH_EFFECTS } from '../search/read.ts'
export const searchStockHandler = (ctx: Ctx, args: Row) => readStockSearch(ctx, args)
export const searchFunctions = {
  searchStock: defineFn({
    input: { href: 'text?', q: 'text?', page: 'int?', pageSize: 'int?' },
    output: {
      query: 'json',
      rows: 'json',
      total: 'int',
      page: 'int',
      pages: 'int',
      counts: 'json',
      isEmpty: 'bool',
      previous: 'text?',
      next: 'text?',
    },
    effects: SEARCH_EFFECTS,
    handler: searchStockHandler,
  }),
}
