import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { readCatalogueSearch, SEARCH_EFFECTS } from '../search/read.ts'
export const searchCatalogueHandler = (ctx: Ctx, args: Row) => readCatalogueSearch(ctx, args)
export const searchFunctions = {
  searchCatalogue: defineFn({
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
    handler: searchCatalogueHandler,
  }),
}
