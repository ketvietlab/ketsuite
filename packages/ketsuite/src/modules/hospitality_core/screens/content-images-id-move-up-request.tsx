import { moveContentImage } from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestContentImagesIdMoveUp: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) =>
    moveContentImage(ctx, url, req, params.id, -1)
