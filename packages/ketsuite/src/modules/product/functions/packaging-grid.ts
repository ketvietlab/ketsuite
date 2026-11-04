import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { barcodeFailure } from '../barcodes.ts'
import {
  PACKAGING_GRID_READ_EFFECTS,
  PACKAGING_GRID_WRITE_EFFECTS,
  PackagingGridRefused,
  productPackagingGrid,
  saveProductPackagingGrid,
} from '../packaging-grid.ts'

export async function getPackagingGridHandler(ctx: Ctx, args: Row) {
  return productPackagingGrid(ctx, args.templateId)
}
export async function savePackagingGridHandler(ctx: Ctx, args: Row) {
  try {
    return await saveProductPackagingGrid(ctx, args)
  } catch (error) {
    if (error instanceof PackagingGridRefused) return error.result
    const refused = barcodeFailure(error)
    if (refused) return refused
    throw error
  }
}
export const packagingGridFunctions: Record<string, FnSpec> = {
  getPackagingGrid: defineFn({
    input: { templateId: 'id' },
    effects: [...PACKAGING_GRID_READ_EFFECTS],
    agent: true,
    handler: getPackagingGridHandler,
  }),
  savePackagingGrid: defineFn({
    input: { templateId: 'id', expectedRevisionId: 'text', changes: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...PACKAGING_GRID_WRITE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: savePackagingGridHandler,
  }),
}
