import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { listSearchFilterFunctions } from '../../backend/search-filter-state.ts'
import { PRODUCT_LIST_EFFECTS, PRODUCT_LIST_OUTPUT, productListShape, readProductList } from '../list/read.ts'
import {
  VARIANT_LIST_EFFECTS,
  VARIANT_LIST_INPUT,
  VARIANT_LIST_OUTPUT,
  readVariantList,
} from '../variants/read.ts'
export const searchTemplatesHandler = (ctx: Ctx, args: Row) => readProductList(ctx, args)
export const searchVariantsHandler = (ctx: Ctx, args: Row) => readVariantList(ctx, args)
export const collectionFunctions = {
  searchVariants: defineFn({
    input: VARIANT_LIST_INPUT,
    output: VARIANT_LIST_OUTPUT,
    effects: [...VARIANT_LIST_EFFECTS],
    handler: searchVariantsHandler,
  }),
  searchTemplates: defineFn({
    input: { href: 'text?', pageSize: 'int?', timezone: 'text?' },
    output: PRODUCT_LIST_OUTPUT,
    effects: [...PRODUCT_LIST_EFFECTS],
    handler: searchTemplatesHandler,
  }),
  ...listSearchFilterFunctions(
    [
      {
        key: 'product.templates',
        path: '/admin/product/templates',
        spec: (ctx) =>
          productListShape(
            ctx.table('product.Template'),
            Boolean(ctx.manifest.functions['stock_backend.searchProductTemplates']),
          ),
      },
    ],
    ['product.Template'],
  ),
}
