import { defineFn } from '@ketvietlab/ketjs'
import {
  CATEGORY_READ_EFFECTS,
  CATEGORY_CONTEXT_EFFECTS,
  searchCategoriesHandler,
  categoryContextHandler,
} from '../categories/read.ts'
export const categoryFunctions = {
  searchCategories: defineFn({
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
    effects: CATEGORY_READ_EFFECTS,
    handler: searchCategoriesHandler,
  }),
  categoryContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: CATEGORY_CONTEXT_EFFECTS,
    handler: categoryContextHandler,
  }),
}
