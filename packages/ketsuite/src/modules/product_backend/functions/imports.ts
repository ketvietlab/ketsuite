import { defineFn } from '@ketvietlab/ketjs'
import { IMPORT_READ_EFFECTS, searchImportsHandler, importContextHandler } from '../imports/read.ts'
export const importFunctions = {
  searchImports: defineFn({
    input: { href: 'text?', pageSize: 'int?', q: 'text?', page: 'int?' },
    output: { query: 'json', rows: 'json', total: 'int', page: 'int', pages: 'int', counts: 'json' },
    effects: IMPORT_READ_EFFECTS,
    handler: searchImportsHandler,
  }),
  importContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: IMPORT_READ_EFFECTS,
    handler: importContextHandler,
  }),
}
