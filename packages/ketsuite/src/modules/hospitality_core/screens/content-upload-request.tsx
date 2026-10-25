import { KetError } from '@ketvietlab/ketjs'
import { validateHospitalityImage } from './content-image-validation.ts'
import {
  contentRedirect,
  contentSelection,
  operationErrors,
  receiveAttachment,
  renderPropertyDetail,
  text,
} from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import type { Attachment } from '../../storage/routes.ts'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestContentUpload: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
    if (!(await ctx.allows('hospitality_core.attachContentImage', url, req)))
      return text(ctx.translate(ctx.localeOf(url, req))('hospitality_core.collection.deniedHint'), {
        status: 403,
      })
    const selection = await contentSelection(ctx, url, req)
    if (
      !selection.propertyId ||
      (url.searchParams.get('target')?.startsWith('room_type:') && !selection.roomTypeId)
    )
      return text('Target not found', { status: 404 })
    const destination = new URL(url)
    destination.pathname = `/admin/hospitality/properties/${encodeURIComponent(selection.propertyId)}`
    destination.searchParams.set('section', 'content')
    destination.searchParams.set('dialog', 'image-upload')
    if (selection.roomTypeId) destination.searchParams.set('photos', selection.roomTypeId)
    let fields: Record<string, string> = {},
      attachment: Awaited<ReturnType<typeof receiveAttachment>> | undefined
    const cleanup = async () => {
      if (attachment) {
        await ctx.callUnchecked('storage.removeAttachment', { id: attachment.id }, url, req)
        await ctx.callUnchecked('storage.requestSweep', { minAgeMs: 0 }, url, req)
      }
    }
    try {
      attachment = await receiveAttachment(ctx, url, req, {
        resModel: selection.roomTypeId ? 'hospitality_core.RoomType' : 'hospitality_core.Property',
        resId: selection.roomTypeId ?? selection.propertyId,
        resField: 'contentImages',
        public: false,
        maxBytes: 10 * 1024 * 1024 + 64 * 1024,
        // Domain upload authority was checked before reading the body. The receiver supplies the exact scoped target; no generic storage right is granted.
        persistAttachment: async (input) =>
          (await ctx.callUnchecked('storage.createAttachment', input, url, req)) as Attachment,
        onFields: (values) => {
          fields = { ...values }
          if (
            !/^\d+$/.test(fields.expectedPropertyVersion ?? '') ||
            !fields.requestKey ||
            fields.requestKey.length < 8 ||
            fields.requestKey.length > 160
          )
            throw new KetError({ code: 'E_HOSPITALITY_CONTENT_INVALID', message: 'Invalid upload command' })
        },
      })
      await validateHospitalityImage(ctx, url, req, attachment)
      const result = (await ctx.call(
        'hospitality_core.attachContentImage',
        {
          id: attachment.id,
          attachmentId: attachment.id,
          ...(selection.roomTypeId
            ? { roomTypeId: selection.roomTypeId }
            : { propertyId: selection.propertyId }),
          category: fields.category,
          caption: fields.caption,
          expectedPropertyVersion: Number(fields.expectedPropertyVersion),
          requestKey: fields.requestKey,
        },
        url,
        req,
      )) as { ok: boolean; errors?: Array<{ code: string; messageKey: string }> }
      if (!result.ok) {
        await cleanup()
        attachment = undefined
        return renderPropertyDetail(
          ctx,
          destination,
          req,
          selection.propertyId,
          operationErrors(ctx, url, req, result),
          undefined,
          fields,
        )
      }
      attachment = undefined // The committed gallery now owns the attachment.
      return contentRedirect(url, selection, 'saved')
    } catch (error) {
      await cleanup()
      if (
        ['E_HOSPITALITY_CONTENT_INVALID', 'E_UPLOAD_FILE', 'E_MULTIPART_LIMIT', 'E_UPLOAD_LIMIT'].includes(
          String((error as { code?: string }).code),
        )
      )
        return renderPropertyDetail(
          ctx,
          destination,
          req,
          selection.propertyId,
          [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.content_image')],
          undefined,
          fields,
        )
      throw error
    }
  }
