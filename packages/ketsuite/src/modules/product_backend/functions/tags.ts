import { defineFn } from '@ketvietlab/ketjs'
import { TAG_READ_EFFECTS, TAG_CONTEXT_EFFECTS, searchTagsHandler, tagContextHandler } from '../tags/read.ts'
export const tagFunctions = {
  searchTags: defineFn({
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
    effects: TAG_READ_EFFECTS,
    handler: searchTagsHandler,
  }),
  tagContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: TAG_CONTEXT_EFFECTS,
    handler: tagContextHandler,
  }),
}
