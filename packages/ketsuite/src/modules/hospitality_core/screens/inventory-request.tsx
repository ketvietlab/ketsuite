import { adminPage, readForm, seeOther, text } from './request-shared.tsx'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { inventoryWorkbenchScreen } from './inventory-workbench.tsx'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import type { InventoryWorkbench, InventoryError } from './inventory-workbench.tsx'

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

export const hospitalityRequestInventory: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
    const canChange = await ctx.allows('hospitality_core.changeInventoryRules', url, req)
    let draft: Record<string, string> | undefined
    let errors: InventoryError[] = []
    if (req.method === 'POST') {
      if (!canChange) return text('Forbidden', { status: 403 })
      draft = await readForm(req)
      if (draft.operation !== 'change-rules') return text('Unknown action', { status: 400 })
      const args: Record<string, unknown> = {
        propertyId: draft.propertyId ?? '',
        roomTypeId: draft.roomTypeId ?? '',
        requestKey: draft.requestKey ?? '',
        from: draft.from ?? '',
        to: draft.to ?? '',
        weekdays: Array.from({ length: 7 }, (_, i) => i + 1).filter((day) => draft![`weekday${day}`] === '1'),
      }
      for (const name of ['expectedVersion', 'total', 'minLos', 'maxLos']) {
        const value = draft[name]?.trim() ?? ''
        if (!value && name !== 'expectedVersion') continue
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          errors.push({
            field: name,
            code: name === 'expectedVersion' ? 'transition_conflict' : 'inventory_integer',
          })
        else args[name] = Number(value)
      }
      for (const name of ['from', 'to'])
        if (!validDate(draft[name] ?? '')) errors.push({ field: name, code: 'date' })
      for (const name of ['stopSell', 'closedToArrival', 'closedToDeparture', 'followRooms']) {
        const value = draft[name]
        if (value === '1' || value === '0') args[name] = value === '1'
        else if (value) errors.push({ field: name, code: 'inventory_choice' })
      }
      if (!errors.length) {
        const result = (await ctx.call('hospitality_core.changeInventoryRules', args, url, req)) as {
          ok: boolean
          errors?: InventoryError[]
        }
        if (result.ok) {
          const next = new URL(url)
          for (const key of ['dialog', 'roomType', 'date', 'action']) next.searchParams.delete(key)
          next.searchParams.set('property', draft.propertyId!)
          next.searchParams.set('status', 'saved')
          return seeOther(next.pathname + next.search)
        }
        errors = result.errors ?? [{ code: 'transition_conflict' }]
      }
    }
    const page = (await ctx.call(
      'hospitality_core.searchProperties',
      { page: 1, pageSize: 1, state: 'all' },
      url,
      req,
    )) as { rows: Array<{ id: string; name: string }> }
    const propertyId = draft?.propertyId ?? url.searchParams.get('property') ?? page.rows[0]?.id
    const start = url.searchParams.get('from')
    const result = propertyId
      ? ((await ctx.call(
          'hospitality_core.getInventoryWorkbench',
          {
            propertyId,
            from: validDate(start ?? '') ? start : undefined,
            page: Number.isSafeInteger(Number(url.searchParams.get('page')))
              ? Number(url.searchParams.get('page'))
              : 1,
          },
          url,
          req,
        )) as { record: InventoryWorkbench | null })
      : { record: null }
    if (propertyId && !result.record) return text('Not found', { status: 404 })
    const _ = ctx.translate(ctx.localeOf(url, req))
    const picker = (
      name: string,
      fn: string,
      label: string,
      value: string,
      options: Array<{ value: string; label: string }>,
      listInput = {},
    ) =>
      relationControl(ctx, url, req, `inventory-${name}`, {
        name,
        ariaLabel: label,
        required: true,
        value,
        options,
        labels: relationLabels(_, label),
        manager: {
          listFunction: `hospitality_core.${fn}`,
          listInput,
          searchInDropdown: true,
          limit: 20,
          resolveParam: 'id',
          idField: 'id',
          labelField: 'name',
          requestQuery: new URLSearchParams(
            [...url.searchParams].filter(([key]) =>
              ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
            ),
          ).toString(),
        },
      })
    const propertyControl = await picker(
      'property',
      'lookupProperties',
      _('hospitality_core.inventoryWorkbench.property'),
      result.record?.property.id ?? '',
      result.record ? [{ value: result.record.property.id, label: result.record.property.name }] : [],
    )
    const chosen =
      draft?.roomTypeId ?? url.searchParams.get('roomType') ?? result.record?.roomTypes[0]?.id ?? ''
    const roomTypeControl =
      canChange &&
      result.record &&
      (draft ||
        url.searchParams.get('dialog') === 'rules' ||
        url.searchParams.get('action') === 'restriction')
        ? await picker(
            'roomTypeId',
            'lookupRoomTypes',
            _('hospitality_core.inventoryWorkbench.roomTypeId'),
            chosen,
            result.record.roomTypes.map((type) => ({ value: type.id, label: type.name })),
            { propertyId: result.record.property.id },
          )
        : undefined
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.inventory.title',
      body: (_, frame) =>
        inventoryWorkbenchScreen(_, frame, result.record, page.rows, canChange, url, draft, errors, {
          propertyControl,
          roomTypeControl,
        }),
    })
  }
