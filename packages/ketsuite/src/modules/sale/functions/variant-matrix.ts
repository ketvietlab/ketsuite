import { saleRecordResult } from '../record-result.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { catalogueFunctions } from './catalogue.ts'
import { catalogueQuantityFunctions } from './catalogue-quantity.ts'
import { variantMatrixTemplates, variantMatrix, saveVariantMatrix } from '../variant-matrix.ts'
export async function listVariantMatricesHandler(ctx: Ctx, args: Row) {
  return variantMatrixTemplates(ctx, args.id)
}
export async function getVariantMatrixHandler(ctx: Ctx, args: Row) {
  return variantMatrix(ctx, args)
}
export async function setVariantMatrixHandler(ctx: Ctx, args: Row) {
  return saleRecordResult(await saveVariantMatrix(ctx, args))
}
const readEffects = catalogueFunctions.getCatalogue.effects!
export const variantMatrixFunctions = {
  listVariantMatrices: defineFn({
    input: { id: 'id' },
    effects: ['read:sale.Order', 'read:product.Template', 'read:product.Product'],
    agent: true,
    handler: listVariantMatricesHandler,
  }),
  getVariantMatrix: defineFn({
    input: { id: 'id', templateId: 'id' },
    effects: readEffects,
    agent: true,
    handler: getVariantMatrixHandler,
  }),
  setVariantMatrix: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      expectedRevision: 'int',
      matrixRevision: 'text',
      quantities: 'json',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      ...readEffects,
      ...catalogueQuantityFunctions.setCatalogueQuantity.effects!,
      'write:product.Template',
    ],
    agent: true,
    idempotent: true,
    handler: setVariantMatrixHandler,
  }),
}
