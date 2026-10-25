import { contentImages, contentRedirect, contentSelection, readForm, text } from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestContentImagesIdMetadata: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const selection = await contentSelection(ctx, url, req)
    const images = await contentImages(ctx, url, req, selection)
    if (!images.some((image) => image.id === params.id)) return text('Image not found', { status: 404 })
    const form = await readForm(req)
    try {
      const result = (await ctx.call(
        'hospitality_core.updateContentImage',
        {
          expectedPropertyVersion: Number(form.expectedPropertyVersion ?? -1),
          requestKey: form.requestKey,
          id: params.id,
          category: form.category ?? '',
          caption: form.caption || undefined,
        },
        url,
        req,
      )) as { ok: boolean }
      if (!result.ok) return contentRedirect(url, selection, 'invalid')
      return contentRedirect(url, selection, 'saved')
    } catch (error) {
      if ((error as { code?: string }).code === 'E_HOSPITALITY_CONTENT_INVALID')
        return contentRedirect(url, selection, 'invalid')
      throw error
    }
  }
