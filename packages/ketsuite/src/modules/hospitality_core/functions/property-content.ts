import { asc, defineFn, deleteFrom, desc, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { appendContentChange } from '../content.ts'
import {
  claimVersion,
  hasPropertyScope,
  propertyAccess,
  readRecord,
  recordChange,
  reject,
  runCommand,
} from './command.ts'

async function selectedTarget(ctx: Ctx, args: Record<string, unknown>) {
  const roomType = args.roomTypeId
    ? await readRecord(ctx, 'hospitality_core.RoomType', args.roomTypeId)
    : null
  if (args.roomTypeId && !roomType) reject('roomTypeId', 'room_type_missing')
  const property = await propertyAccess(ctx, roomType?.propertyId ?? args.propertyId)
  if (args.propertyId && property.id !== args.propertyId) reject('propertyId', 'property_mismatch')
  return { property, roomType, key: roomType ? `room-type:${roomType.id}` : `property:${property.id}` }
}
function language(value: unknown) {
  try {
    const code = Intl.getCanonicalLocales(String(value ?? '').trim())[0]
    if (code) return code
  } catch {}
  return reject('locale', 'content_locale')
}
const reads = [
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.ContentLocale',
]
const writes = [
  'write:hospitality_core.Property',
  'write:hospitality_core.ContentLocale',
  'write:hospitality_core.ContentChange',
  'write:hospitality_core.OperationalChange',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
]

export const propertyContentFunctions: Record<string, FnSpec> = {
  getPropertyProfile: defineFn({
    input: { id: 'id' },
    output: { property: 'json?' },
    effects: ['read:hospitality_core.Property'],
    handler: async (ctx, args) => {
      const property = await readRecord(ctx, 'hospitality_core.Property', args.id)
      return { property: property && hasPropertyScope(ctx, property) ? property : null }
    },
  }),
  getCataloguePropertyContext: defineFn({
    input: { id: 'id' },
    output: { property: 'json?' },
    effects: ['read:hospitality_core.Property'],
    handler: async (ctx, args) => {
      const property = await readRecord(ctx, 'hospitality_core.Property', args.id)
      if (!property || !hasPropertyScope(ctx, property)) return { property: null }
      return {
        property: Object.fromEntries(
          ['id', 'version', 'name', 'publicName', 'description', 'timezone'].map((key) => [
            key,
            property[key] ?? null,
          ]),
        ),
      }
    },
  }),
  recordContentImageEvidence: defineFn({
    exposure: 'internal',
    input: { attachmentId: 'id', checksum: 'text', mimetype: 'text', width: 'int', height: 'int' },
    output: { ok: 'bool', id: 'id?' },
    effects: [
      'read:storage.Attachment',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.ContentImageEvidence',
      'write:hospitality_core.ContentImageEvidence',
    ],
    handler: async (ctx, args) => {
      const attachment = await readRecord(ctx, 'storage.Attachment', args.attachmentId)
      if (
        !attachment ||
        attachment.checksum !== args.checksum ||
        attachment.mimetype !== args.mimetype ||
        Number(attachment.size) > 10 * 1024 * 1024 ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(String(args.mimetype)) ||
        Number(args.width) < 1024 ||
        Number(args.height) < 1024
      )
        reject('attachmentId', 'content_image')
      if (!['hospitality_core.Property', 'hospitality_core.RoomType'].includes(String(attachment.resModel)))
        reject('attachmentId', 'content_image')
      await selectedTarget(
        ctx,
        attachment.resModel === 'hospitality_core.Property'
          ? { propertyId: attachment.resId }
          : { roomTypeId: attachment.resId },
      )
      const id = String(attachment.id),
        prior = await readRecord(ctx, 'hospitality_core.ContentImageEvidence', id)
      if (prior) {
        if (
          prior.checksum !== args.checksum ||
          prior.width !== args.width ||
          prior.height !== args.height ||
          prior.mimetype !== args.mimetype
        )
          reject('attachmentId', 'content_image')
        return { ok: true, id }
      }
      await ctx.db.insertIfAbsent('hospitality_core.ContentImageEvidence', {
        id,
        attachmentId: id,
        checksum: args.checksum,
        mimetype: args.mimetype,
        width: args.width,
        height: args.height,
        verifiedAt: new Date().toISOString(),
      })
      return { ok: true, id }
    },
  }),
  saveContentLocale: defineFn({
    input: {
      id: 'id?',
      propertyId: 'id',
      roomTypeId: 'id?',
      locale: 'text',
      title: 'text',
      description: 'text',
      expectedVersion: 'int',
      expectedPropertyVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [...reads, ...writes],
    idempotent: true,
    handler: (ctx, args) =>
      runCommand(ctx, args, 'saveContentLocale', async (tx) => {
        const target = await selectedTarget(tx, args),
          locale = language(args.locale),
          id = `${target.key}:${locale}`
        const title = String(args.title).trim(),
          description = String(args.description).trim()
        if (!title || title.length > 200) reject('title', 'required')
        if (!description || description.length > 10000) reject('description', 'required')
        const prior = await readRecord(tx, 'hospitality_core.ContentLocale', id)
        if (prior && args.expectedVersion === 0) reject('locale', 'content_locale_duplicate')
        if (prior && args.id && args.id !== id) reject('locale', 'immutable_code')
        if (!prior && args.expectedVersion !== 0) reject('expectedVersion', 'transition_conflict')
        await claimVersion(tx, 'hospitality_core.Property', target.property, args.expectedPropertyVersion)
        if (prior) await claimVersion(tx, 'hospitality_core.ContentLocale', prior, args.expectedVersion)
        const values = {
          propertyId: target.property.id,
          roomTypeId: target.roomType?.id ?? null,
          targetKey: target.key,
          locale,
          title,
          description,
          version: Number(prior?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }
        if (prior) await tx.db.update('hospitality_core.ContentLocale', { id }, values)
        else await tx.db.insert('hospitality_core.ContentLocale', { id, ...values })
        await appendContentChange(tx, {
          propertyId: target.property.id,
          resourceType: target.roomType ? 'room_type' : 'property',
          resourceId: target.roomType?.id ?? target.property.id,
        })
        await recordChange(tx, target.property.id, id, 'content-locale', { locale })
        return { ok: true, id, version: values.version, errors: [] }
      }),
  }),
  removeContentLocale: defineFn({
    input: {
      propertyId: 'id',
      roomTypeId: 'id?',
      locale: 'text',
      expectedVersion: 'int',
      expectedPropertyVersion: 'int',
      requestKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...reads, ...writes],
    idempotent: true,
    handler: (ctx, args) =>
      runCommand(ctx, args, 'removeContentLocale', async (tx) => {
        const target = await selectedTarget(tx, args),
          locale = language(args.locale),
          id = `${target.key}:${locale}`
        if (locale === 'vi') reject('locale', 'content_default_locale')
        const prior = await readRecord(tx, 'hospitality_core.ContentLocale', id)
        if (!prior) reject('locale', 'record_missing')
        await claimVersion(tx, 'hospitality_core.Property', target.property, args.expectedPropertyVersion)
        await claimVersion(tx, 'hospitality_core.ContentLocale', prior, args.expectedVersion)
        const L = tx.table('hospitality_core.ContentLocale')
        await tx.db.del(deleteFrom(L).where(eq(L.id, id), eq(L.companyId!, tx.scope.company)))
        await appendContentChange(tx, {
          propertyId: target.property.id,
          resourceType: target.roomType ? 'room_type' : 'property',
          resourceId: target.roomType?.id ?? target.property.id,
        })
        await recordChange(tx, target.property.id, id, 'content-locale-remove', { locale })
        return { ok: true, id, errors: [] }
      }),
  }),
  getPropertyWorkbench: defineFn({
    input: { propertyId: 'id' },
    output: {
      buildings: 'json',
      floors: 'json',
      charges: 'json',
      locales: 'json',
      roomTypes: 'json',
      imageCount: 'int',
      primaryImage: 'bool',
      missingContent: 'json',
      history: 'json',
      timezoneLocked: 'bool',
    },
    effects: [
      ...reads,
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.PropertyCharge',
      'read:hospitality_core.ContentImage',
      'read:hospitality_core.OperationalChange',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Room',
      'read:hospitality_core.CancellationPolicy',
      'read:user.User',
    ],
    handler: async (ctx, args) => {
      const property = await propertyAccess(ctx, args.propertyId)
      const rows = async (model: string, fields: string[]) => {
        const T = ctx.table(`hospitality_core.${model}`)
        return ctx.db.all(
          from(T)
            .select(...fields.map((key) => T[key]!))
            .where(eq(T.companyId!, ctx.scope.company), eq(T.propertyId, property.id))
            .orderBy(asc(T.id))
            .limit(1000),
        )
      }
      const [buildings, floors, charges, locales, roomTypes] = await Promise.all([
        rows('Building', ['id', 'version', 'code', 'name', 'sequence', 'active']),
        rows('Floor', ['id', 'version', 'buildingId', 'code', 'name', 'sequence', 'level', 'active']),
        rows('PropertyCharge', [
          'id',
          'version',
          'chargeType',
          'basis',
          'included',
          'name',
          'amount',
          'description',
          'active',
        ]),
        rows('ContentLocale', ['id', 'version', 'roomTypeId', 'locale', 'title', 'description']),
        rows('RoomType', ['id', 'name', 'active']),
      ])
      const Room = ctx.table('hospitality_core.Room'),
        Floor = ctx.table('hospitality_core.Floor')
      const roomScope = from(Room).where(
        eq(Room.companyId!, ctx.scope.company),
        eq(Room.propertyId, property.id),
      )
      const [buildingRooms, floorRooms, buildingActiveRooms, floorActiveRooms, activeFloors] =
        await Promise.all([
          ctx.db.group(roomScope.groupBy({ col: Room.buildingId! })),
          ctx.db.group(roomScope.groupBy({ col: Room.floorId! })),
          ctx.db.group(roomScope.where(eq(Room.active, true)).groupBy({ col: Room.buildingId! })),
          ctx.db.group(roomScope.where(eq(Room.active, true)).groupBy({ col: Room.floorId! })),
          ctx.db.group(
            from(Floor)
              .where(
                eq(Floor.companyId!, ctx.scope.company),
                eq(Floor.propertyId, property.id),
                eq(Floor.active, true),
              )
              .groupBy({ col: Floor.buildingId }),
          ),
        ])
      const countMap = (groups: Array<{ key: unknown[]; count: number }>) =>
        new Map(groups.map((row) => [row.key[0], Number(row.count)]))
      const buildingCounts = countMap(buildingRooms),
        floorCounts = countMap(floorRooms),
        buildingActive = countMap(buildingActiveRooms),
        floorActive = countMap(floorActiveRooms),
        activeFloorCounts = countMap(activeFloors)
      const I = ctx.table('hospitality_core.ContentImage')
      const imageScope = from(I).where(eq(I.companyId!, ctx.scope.company))
      const [imageCount, primary, roomImages] = await Promise.all([
        ctx.db.count(imageScope.where(eq(I.propertyId!, property.id))),
        ctx.db.count(imageScope.where(eq(I.propertyId!, property.id), eq(I.primary, true))),
        ctx.db.group(
          imageScope
            .where(
              inArray(
                I.roomTypeId!,
                roomTypes.map((row) => row.id),
              ),
            )
            .groupBy({ col: I.roomTypeId! }),
        ),
      ])
      const counts = new Map(roomImages.map((row) => [row.key[0], row.count])),
        missingContent: Array<{ code: string; roomTypeId?: string; name?: string }> = []
      const propertyLocales = locales.filter((row) => !row.roomTypeId)
      for (const locale of ['vi', 'en'])
        if (
          !propertyLocales.some((row) => row.locale === locale && String(row.description ?? '').trim()) &&
          !(locale === 'vi' && String(property.description ?? '').trim())
        )
          missingContent.push({ code: `description_${locale}` })
      if (imageCount < 5) missingContent.push({ code: 'property_images' })
      if (!primary) missingContent.push({ code: 'primary_image' })
      if (!roomTypes.some((row) => row.active)) missingContent.push({ code: 'room_types' })
      for (const roomType of roomTypes.filter((row) => row.active))
        if (Number(counts.get(roomType.id) ?? 0) < 3)
          missingContent.push({
            code: 'room_type_images',
            roomTypeId: String(roomType.id),
            name: String(roomType.name),
          })
      if (!property.defaultCheckIn || !property.defaultCheckOut) missingContent.push({ code: 'check_in_out' })
      const policy = property.defaultCancellationPolicyId
        ? await readRecord(ctx, 'hospitality_core.CancellationPolicy', property.defaultCancellationPolicyId)
        : null
      if (!policy || policy.active !== true) missingContent.push({ code: 'cancellation_policy' })
      const H = ctx.table('hospitality_core.OperationalChange')
      let history: Row[] = await ctx.db.all(
        from(H)
          .select(H.id, H.action, H.entityId, H.actorId!, H.occurredAt, H.details)
          .where(eq(H.companyId!, ctx.scope.company), eq(H.propertyId, property.id))
          .orderBy(desc(H.occurredAt), desc(H.id))
          .limit(50),
      )
      if (ctx.manifest.models['user.User']) {
        const U = ctx.table('user.User'),
          ids = [...new Set(history.map((row) => row.actorId).filter(Boolean))]
        const users = ids.length
          ? await ctx.db.all(from(U).select(U.id, U.name).where(inArray(U.id, ids)).limit(50))
          : []
        const names = new Map(users.map((row) => [row.id, row.name]))
        history = history.map((row) => ({ ...row, actorName: names.get(row.actorId) ?? null }))
      }
      const R = ctx.table('hospitality_core.Reservation')
      const timezoneLocked =
        (await ctx.db.count(
          from(R).where(eq(R.companyId!, ctx.scope.company), eq(R.propertyId, property.id)),
        )) > 0
      return {
        buildings: buildings.map((row) => ({
          ...row,
          roomCount: buildingCounts.get(row.id) ?? 0,
          activeRoomCount: buildingActive.get(row.id) ?? 0,
          activeFloorCount: activeFloorCounts.get(row.id) ?? 0,
        })),
        floors: floors.map((row) => ({
          ...row,
          roomCount: floorCounts.get(row.id) ?? 0,
          activeRoomCount: floorActive.get(row.id) ?? 0,
        })),
        charges,
        locales,
        roomTypes: roomTypes.map((row) => ({ ...row, imageCount: Number(counts.get(row.id) ?? 0) })),
        imageCount,
        primaryImage: primary > 0,
        missingContent,
        history,
        timezoneLocked,
      }
    },
  }),
}
