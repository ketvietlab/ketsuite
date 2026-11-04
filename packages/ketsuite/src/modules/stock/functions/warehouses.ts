import { RECEPTION_STEPS, DELIVERY_STEPS } from '../types.ts'
import { RESERVATION_METHODS } from '../reservation-policy.ts'
import { invalid } from '../inventory-validation.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { company, ours } from '../scope.ts'
import { assignWarehouseUsers, warehousePeople, withWarehouseUsers } from '../warehouse-users.ts'

export async function listWarehousesHandler(ctx: Ctx) {
  return withWarehouseUsers(ctx, await ours(ctx, 'stock.Warehouse', { active: true }))
}

export const listWarehousePeopleHandler = (ctx: Ctx) => warehousePeople(ctx)

/** K15 (#1428): who works at the warehouse, when the caller names them; only the company's active people. */
async function warehouseUsersOf(ctx: Ctx, value: unknown) {
  if (value == null) return { ok: true as const, userIds: null }
  const ids = Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : null
  const known = ids && ids.length <= 200 ? await warehousePeople(ctx, ids) : []
  return ids && known.length === ids.length
    ? { ok: true as const, userIds: ids }
    : {
        ok: false as const,
        result: { ok: false, errors: [{ field: 'userIds', messageKey: 'stock.error.warehouseUser' }] },
      }
}

export async function saveWarehouseHandler(ctx: Ctx, args: Row) {
  const receptionSteps = args.receptionSteps ?? 'one_step'
  const deliverySteps = args.deliverySteps ?? 'ship_only'
  if (!RECEPTION_STEPS.includes(receptionSteps as never))
    return invalid('receptionSteps', `phải là: ${RECEPTION_STEPS.join(', ')}`)
  if (!DELIVERY_STEPS.includes(deliverySteps as never))
    return invalid('deliverySteps', `phải là: ${DELIVERY_STEPS.join(', ')}`)
  // K62: whole days to a year between full counts; none (0) leaves the warehouse off the cycle.
  const frequency = args.countFrequencyDays == null ? undefined : Number(args.countFrequencyDays)
  if (frequency !== undefined && !(Number.isInteger(frequency) && frequency >= 0 && frequency <= 365))
    return {
      ok: false,
      errors: [
        { field: 'countFrequencyDays', messageKey: 'stock.error.countFrequency', params: { max: 365 } },
      ],
    }
  // K60: how transfers take goods; whole days to a year before the scheduled day when by date.
  if (args.reservationMethod != null && !RESERVATION_METHODS.includes(args.reservationMethod as never))
    return {
      ok: false,
      errors: [{ field: 'reservationMethod', messageKey: 'stock.error.reservationMethod' }],
    }
  for (const field of ['reservationDaysBefore', 'reservationDaysBeforePriority']) {
    if (args[field] == null) continue
    const days = Number(args[field])
    if (!(Number.isInteger(days) && days >= 0 && days <= 365))
      return {
        ok: false,
        errors: [{ field, messageKey: 'stock.error.reservationDays', params: { max: 365 } }],
      }
  }
  const people = await warehouseUsersOf(ctx, args.userIds)
  if (!people.ok) return people.result
  const existing = (await ours(ctx, 'stock.Warehouse', { id: args.id }))[0]
  const values = {
    ...args,
    receptionSteps,
    deliverySteps,
    active: true,
    ...(frequency === undefined ? {} : { countFrequencyDays: frequency || null }),
  }
  const cs = ctx
    .change('stock.Warehouse', values, existing ?? null)
    .cast([
      'id',
      'name',
      'code',
      'receptionSteps',
      'deliverySteps',
      'active',
      'countFrequencyDays',
      'reservationMethod',
      'reservationDaysBefore',
      'reservationDaysBeforePriority',
    ])
    .required(['name', 'code'])
  if (!cs.valid) return { ok: false, errors: cs.errors }
  await ctx.tx(async (tx) => {
    await tx.db.commit(cs, existing ? { id: args.id } : undefined)
    if (people.userIds) await assignWarehouseUsers(tx, String(args.id), people.userIds)
    const viewId = `${String(args.id)}:view`
    const locations = [
      { suffix: 'view', name: String(args.name), usage: 'view', parentId: null, active: true },
      { suffix: 'stock', name: 'Stock', usage: 'internal', parentId: viewId, active: true },
      {
        suffix: 'input',
        name: 'Input',
        usage: 'internal',
        parentId: viewId,
        active: receptionSteps !== 'one_step',
      },
      {
        suffix: 'quality',
        name: 'Quality',
        usage: 'internal',
        parentId: viewId,
        active: receptionSteps === 'three_steps',
      },
      {
        suffix: 'output',
        name: 'Output',
        usage: 'internal',
        parentId: viewId,
        active: deliverySteps !== 'ship_only',
      },
      {
        suffix: 'pick',
        name: 'Pick',
        usage: 'internal',
        parentId: viewId,
        active: deliverySteps !== 'ship_only',
      },
      {
        suffix: 'pack',
        name: 'Pack',
        usage: 'internal',
        parentId: viewId,
        active: deliverySteps === 'pick_pack_ship',
      },
      { suffix: 'supplier', name: 'Supplier', usage: 'supplier', parentId: null, active: true },
      { suffix: 'customer', name: 'Customer', usage: 'customer', parentId: null, active: true },
      // K59: where scrapped goods go; a warehouse made before scrap orders gains it on its first scrap.
      { suffix: 'scrap', name: 'Scrap', usage: 'scrap', parentId: null, active: true },
      // K36: where count differences come from and go to; older warehouses gain it on their first approved count.
      {
        suffix: 'adjustment',
        name: 'Inventory adjustment',
        usage: 'inventory',
        parentId: null,
        active: true,
      },
    ]
    for (const location of locations) {
      const id = `${String(args.id)}:${location.suffix}`
      const values = {
        name: location.name,
        usage: location.usage,
        parentId: location.parentId,
        parentPath: location.parentId ? `${viewId}/${id}/` : `${id}/`,
        warehouseId: args.id,
        active: location.active,
      }
      const found = (await ours(tx, 'stock.Location', { id }))[0]
      if (found) await tx.db.update('stock.Location', { id }, values)
      else await tx.db.insert('stock.Location', { id, ...values })
    }
    const incomingDestination =
      receptionSteps === 'one_step' ? `${String(args.id)}:stock` : `${String(args.id)}:input`
    const outgoingSource =
      deliverySteps === 'ship_only' ? `${String(args.id)}:stock` : `${String(args.id)}:output`
    const types = [
      {
        id: `${String(args.id)}:incoming`,
        name: 'Receipts',
        code: 'incoming',
        source: `${String(args.id)}:supplier`,
        destination: incomingDestination,
      },
      {
        id: `${String(args.id)}:outgoing`,
        name: 'Delivery Orders',
        code: 'outgoing',
        source: outgoingSource,
        destination: `${String(args.id)}:customer`,
        active: true,
      },
      {
        id: `${String(args.id)}:internal`,
        name: 'Internal Transfers',
        code: 'internal',
        source: `${String(args.id)}:stock`,
        destination: `${String(args.id)}:output`,
        active: true,
      },
      {
        id: `${String(args.id)}:quality`,
        name: 'Quality Control',
        code: 'internal',
        source: `${String(args.id)}:input`,
        destination: `${String(args.id)}:quality`,
        active: receptionSteps === 'three_steps',
      },
      {
        id: `${String(args.id)}:store`,
        name: 'Store',
        code: 'internal',
        source: receptionSteps === 'three_steps' ? `${String(args.id)}:quality` : `${String(args.id)}:input`,
        destination: `${String(args.id)}:stock`,
        active: receptionSteps !== 'one_step',
      },
      {
        id: `${String(args.id)}:pick`,
        name: 'Pick',
        code: 'internal',
        source: `${String(args.id)}:stock`,
        destination:
          deliverySteps === 'pick_pack_ship' ? `${String(args.id)}:pack` : `${String(args.id)}:output`,
        active: deliverySteps !== 'ship_only',
      },
      {
        id: `${String(args.id)}:pack`,
        name: 'Pack',
        code: 'internal',
        source: `${String(args.id)}:pack`,
        destination: `${String(args.id)}:output`,
        active: deliverySteps === 'pick_pack_ship',
      },
    ]
    for (const type of types) {
      const values = {
        name: type.name,
        code: type.code,
        warehouseId: args.id,
        defaultLocationSrcId: type.source,
        defaultLocationDestId: type.destination,
        createBackorder: 'ask',
        active: type.active ?? true,
      }
      const found = (await ours(tx, 'stock.PickingType', { id: type.id }))[0]
      if (found) await tx.db.update('stock.PickingType', { id: type.id }, values)
      else await tx.db.insert('stock.PickingType', { id: type.id, ...values })
    }

    const warehouseId = String(args.id)
    const receiptRouteId = `${warehouseId}:receipt-route`
    const deliveryRouteId = `${warehouseId}:delivery-route`
    const routes = [
      { id: receiptRouteId, name: `${String(args.name)}: ${receptionSteps}`, sequence: 50 },
      { id: deliveryRouteId, name: `${String(args.name)}: ${deliverySteps}`, sequence: 60 },
    ]
    for (const route of routes) {
      const found = (await ours(tx, 'stock.Route', { id: route.id }))[0]
      const values = { name: route.name, sequence: route.sequence, active: true }
      if (found) await tx.db.update('stock.Route', { id: route.id }, values)
      else await tx.db.insert('stock.Route', { id: route.id, ...values })
      await tx.db.insertIfAbsent('stock.WarehouseRoute', {
        id: `${company(tx)}:${warehouseId}:${route.id}`,
        warehouseId: args.id,
        routeId: route.id,
      })
    }

    // The subset executes route chains backwards from demand, so each leg is
    // represented as a pull rule. The resulting locations and operation types
    // match the domain contract's receipt/delivery topology.
    const ruleDefinitions = [
      {
        id: `${warehouseId}:receipt:supplier-stock`,
        name: 'Receive in Stock',
        routeId: receiptRouteId,
        source: `${warehouseId}:supplier`,
        destination: `${warehouseId}:stock`,
        pickingTypeId: `${warehouseId}:incoming`,
        active: receptionSteps === 'one_step',
      },
      {
        id: `${warehouseId}:receipt:supplier-input`,
        name: 'Receive in Input',
        routeId: receiptRouteId,
        source: `${warehouseId}:supplier`,
        destination: `${warehouseId}:input`,
        pickingTypeId: `${warehouseId}:incoming`,
        active: receptionSteps !== 'one_step',
      },
      {
        id: `${warehouseId}:receipt:input-stock`,
        name: 'Input to Stock',
        routeId: receiptRouteId,
        source: `${warehouseId}:input`,
        destination: `${warehouseId}:stock`,
        pickingTypeId: `${warehouseId}:store`,
        active: receptionSteps === 'two_steps',
      },
      {
        id: `${warehouseId}:receipt:input-quality`,
        name: 'Input to Quality',
        routeId: receiptRouteId,
        source: `${warehouseId}:input`,
        destination: `${warehouseId}:quality`,
        pickingTypeId: `${warehouseId}:quality`,
        active: receptionSteps === 'three_steps',
      },
      {
        id: `${warehouseId}:receipt:quality-stock`,
        name: 'Quality to Stock',
        routeId: receiptRouteId,
        source: `${warehouseId}:quality`,
        destination: `${warehouseId}:stock`,
        pickingTypeId: `${warehouseId}:store`,
        active: receptionSteps === 'three_steps',
      },
      {
        id: `${warehouseId}:delivery:stock-customer`,
        name: 'Deliver from Stock',
        routeId: deliveryRouteId,
        source: `${warehouseId}:stock`,
        destination: `${warehouseId}:customer`,
        pickingTypeId: `${warehouseId}:outgoing`,
        active: deliverySteps === 'ship_only',
      },
      {
        id: `${warehouseId}:delivery:stock-output`,
        name: 'Pick to Output',
        routeId: deliveryRouteId,
        source: `${warehouseId}:stock`,
        destination: `${warehouseId}:output`,
        pickingTypeId: `${warehouseId}:pick`,
        procureMethod: 'make_to_stock',
        active: deliverySteps === 'pick_ship',
      },
      {
        id: `${warehouseId}:delivery:stock-pack`,
        name: 'Pick to Pack',
        routeId: deliveryRouteId,
        source: `${warehouseId}:stock`,
        destination: `${warehouseId}:pack`,
        pickingTypeId: `${warehouseId}:pick`,
        procureMethod: 'make_to_stock',
        active: deliverySteps === 'pick_pack_ship',
      },
      {
        id: `${warehouseId}:delivery:pack-output`,
        name: 'Pack to Output',
        routeId: deliveryRouteId,
        source: `${warehouseId}:pack`,
        destination: `${warehouseId}:output`,
        pickingTypeId: `${warehouseId}:pack`,
        active: deliverySteps === 'pick_pack_ship',
      },
      {
        id: `${warehouseId}:delivery:output-customer`,
        name: 'Ship from Output',
        routeId: deliveryRouteId,
        source: `${warehouseId}:output`,
        destination: `${warehouseId}:customer`,
        pickingTypeId: `${warehouseId}:outgoing`,
        active: deliverySteps !== 'ship_only',
      },
    ]
    for (const [sequence, rule] of ruleDefinitions.entries()) {
      const values = {
        name: rule.name,
        routeId: rule.routeId,
        action: 'pull',
        sequence: sequence + 10,
        locationSrcId: rule.source,
        locationDestId: rule.destination,
        pickingTypeId: rule.pickingTypeId,
        procureMethod: rule.procureMethod ?? 'make_to_order',
        active: rule.active,
      }
      const found = (await ours(tx, 'stock.Rule', { id: rule.id }))[0]
      if (found) await tx.db.update('stock.Rule', { id: rule.id }, values)
      else await tx.db.insert('stock.Rule', { id: rule.id, ...values })
    }
  })
  return { ok: true, id: args.id }
}

export const warehousesFunctions: Record<string, FnSpec> = {
  listWarehouses: defineFn({
    input: {},
    effects: ['read:stock.Warehouse', 'read:stock.WarehouseUser'],
    agent: true,
    handler: listWarehousesHandler,
  }),

  listWarehousePeople: defineFn({
    input: {},
    effects: ['read:user.Membership', 'read:user.User'],
    agent: true,
    handler: listWarehousePeopleHandler,
  }),

  saveWarehouse: defineFn({
    input: {
      id: 'id',
      name: 'text',
      code: 'text',
      receptionSteps: 'text?',
      deliverySteps: 'text?',
      countFrequencyDays: 'int?',
      reservationMethod: 'text?',
      reservationDaysBefore: 'int?',
      reservationDaysBeforePriority: 'int?',
      userIds: 'json?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Warehouse',
      'write:stock.Warehouse',
      'read:stock.Location',
      'write:stock.Location',
      'read:stock.PickingType',
      'write:stock.PickingType',
      'read:stock.Route',
      'write:stock.Route',
      'read:stock.Rule',
      'write:stock.Rule',
      'read:stock.WarehouseRoute',
      'write:stock.WarehouseRoute',
      'read:stock.WarehouseUser',
      'write:stock.WarehouseUser',
      'read:user.Membership',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: saveWarehouseHandler,
  }),
}
