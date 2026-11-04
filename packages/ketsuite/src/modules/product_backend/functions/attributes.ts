import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { attributeSearchHref } from '../attribute-search-state.ts'

export function applyAttributeSearchFilterHandler(_ctx: Ctx, args: Row) {
  return { href: attributeSearchHref(args) }
}
export const attributeFunctions = {
  applyAttributeSearchFilter: defineFn({
    input: {
      query: 'text?',
      returnTo: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: ['read:product.Attribute'],
    handler: applyAttributeSearchFilterHandler,
  }),
}
