import type { ServeContext } from '@ketvietlab/ketjs'
import type { Route } from '@ketvietlab/ketjs'

export async function propertyWorkbenchAction(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  propertyId: string,
  form: Record<string, string>,
) {
  const bool = (value: string | undefined) => ['1', 'true', 'on'].includes(value ?? '')
  const common = {
    propertyId,
    id: form.id,
    expectedVersion: Number(form.expectedVersion ?? 0),
    expectedPropertyVersion: Number(form.expectedPropertyVersion ?? 0),
    requestKey: form.requestKey,
  }
  let fn: string, input: Record<string, unknown>
  switch (form.operation) {
    case 'lifecycle':
      fn = 'setPropertyLifecycle'
      input = {
        propertyId,
        lifecycle: form.lifecycle,
        expectedVersion: common.expectedVersion,
        requestKey: common.requestKey,
      }
      break
    case 'inspection':
      fn = 'setInspectionRequirement'
      input = {
        propertyId,
        required: bool(form.required),
        expectedVersion: common.expectedVersion,
        requestKey: common.requestKey,
      }
      break
    case 'building-active':
      fn = 'archiveBuilding'
      input = { ...common, active: bool(form.active) }
      break
    case 'floor-active':
      fn = 'archiveFloor'
      input = { ...common, active: bool(form.active) }
      break
    case 'save-building':
      fn = 'saveBuilding'
      input = { ...common, code: form.code, name: form.name }
      break
    case 'save-floor':
      fn = 'saveFloor'
      input = { ...common, buildingId: form.buildingId, code: form.code, name: form.name }
      break
    case 'save-fee':
      fn = 'savePropertyCharge'
      input = {
        ...common,
        chargeType: form.chargeType,
        name: form.name,
        amount: form.amount,
        description: form.description,
        basis: form.basis,
        included: bool(form.included),
        active: bool(form.active),
      }
      break
    case 'save-locale':
      fn = 'saveContentLocale'
      input = {
        propertyId,
        roomTypeId: form.roomTypeId || undefined,
        locale: form.locale,
        title: form.title,
        description: form.description,
        expectedVersion: common.expectedVersion,
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    case 'remove-locale':
      fn = 'removeContentLocale'
      input = {
        propertyId,
        roomTypeId: form.roomTypeId || undefined,
        locale: form.locale,
        expectedVersion: common.expectedVersion,
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    case 'image-update':
      fn = 'updateContentImage'
      input = {
        id: form.imageId,
        category: form.category,
        caption: form.caption,
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    case 'image-primary':
      fn = 'setPrimaryContentImage'
      input = {
        id: form.imageId,
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    case 'image-remove':
      fn = 'removeContentImage'
      input = {
        id: form.imageId,
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    case 'image-reorder':
      fn = 'reorderContentImages'
      input = {
        ...(form.roomTypeId ? { roomTypeId: form.roomTypeId } : { propertyId }),
        ids: (() => {
          try {
            return JSON.parse(form.ids ?? '[]')
          } catch {
            return []
          }
        })(),
        expectedPropertyVersion: common.expectedPropertyVersion,
        requestKey: common.requestKey,
      }
      break
    default:
      return null
  }
  if (form.operation?.startsWith('image-')) {
    const images = (await ctx.call(
      'hospitality_core.listContentImages',
      form.roomTypeId ? { roomTypeId: form.roomTypeId } : { propertyId },
      url,
      req,
    )) as Array<Record<string, unknown>>
    if (form.imageId && !images.some((row) => row.id === form.imageId))
      return {
        ok: false,
        errors: [{ code: 'content_target', messageKey: 'hospitality_core.validation.content_target' }],
      }
    if (form.roomTypeId) {
      const context = (await ctx.call('hospitality_core.getPropertyWorkbench', { propertyId }, url, req)) as {
        roomTypes: Array<Record<string, unknown>>
      }
      if (!context.roomTypes.some((row) => row.id === form.roomTypeId))
        return {
          ok: false,
          errors: [{ code: 'content_target', messageKey: 'hospitality_core.validation.content_target' }],
        }
    }
  }
  return (await ctx.call(`hospitality_core.${fn}`, input, url, req)) as {
    ok: boolean
    id?: string
    errors?: Array<{ code: string; messageKey: string }>
  }
}
