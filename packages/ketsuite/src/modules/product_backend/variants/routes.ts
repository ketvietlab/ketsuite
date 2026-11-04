import type { RouteEntry } from '@ketvietlab/ketjs'
import { variantCollectionScreen } from '../screens/variants.tsx'
import { VARIANT_LIST_PATH } from './shape.ts'
export const variantRoutes: Record<string, RouteEntry> = {
  [VARIANT_LIST_PATH]: (ctx) => (url, req) => variantCollectionScreen(ctx, url, req),
}
