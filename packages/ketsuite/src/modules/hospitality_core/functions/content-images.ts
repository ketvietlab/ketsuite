import { asc, defineFn, deleteFrom, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { appendContentChange } from '../content-change.ts'
import { CONTENT_IMAGE_CATEGORIES } from '../types.ts'
import { claimVersion, propertyAccess, readRecord, recordChange, reject, runCommand } from './command.ts'

const reads = [
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.ContentImage',
  'read:storage.Attachment',
  'read:hospitality_core.ContentImageEvidence',
]
const writes = [
  ...reads,
  'write:hospitality_core.Property',
  'write:hospitality_core.ContentImage',
  'write:hospitality_core.ContentChange',
  'write:hospitality_core.OperationalChange',
  'read:hospitality_core.CommandReceipt',
  'write:hospitality_core.CommandReceipt',
]
const fence = { expectedPropertyVersion: 'int', requestKey: 'text' }
const result = {
  ok: 'bool',
  id: 'id?',
  errors: 'json?',
  attachmentId: 'id?',
  propertyId: 'id?',
  roomTypeId: 'id?',
  category: 'text?',
  caption: 'text?',
  primary: 'bool?',
  sequence: 'int?',
  createdAt: 'datetime?',
  updatedAt: 'datetime?',
}
type Args = Record<string, unknown>

async function target(ctx: Ctx, args: Args) {
  if (Boolean(args.propertyId) === Boolean(args.roomTypeId)) reject('propertyId', 'content_target')
  const roomType = args.roomTypeId
    ? await readRecord(ctx, 'hospitality_core.RoomType', args.roomTypeId)
    : null
  if (args.roomTypeId && !roomType) reject('roomTypeId', 'room_type_missing')
  const property = await propertyAccess(ctx, roomType?.propertyId ?? args.propertyId)
  return { property, roomType, key: roomType ? `room_type:${roomType.id}` : `property:${property.id}` }
}
async function rows(ctx: Ctx, selected: Awaited<ReturnType<typeof target>>) {
  const I = ctx.table('hospitality_core.ContentImage')
  const items = await ctx.db.all(
    from(I)
      .where(eq(I.companyId!, ctx.scope.company), eq(I.targetKey, selected.key))
      .orderBy(asc(I.sequence), asc(I.id))
      .limit(31)
      .preload('attachment'),
  )
  // A corrupt/legacy over-limit collection must not silently lose images during reorder.
  if (items.length > 30) reject('id', 'content_image_limit')
  return items
}
export async function listContentImages(ctx: Ctx, args: Args) {
  const selected = await target(ctx, args),
    items = await rows(ctx, selected)
  return items.map((row) => ({
    ...row,
    attachment: row.attachment
      ? {
          id: (row.attachment as Row).id,
          name: (row.attachment as Row).name,
          mimetype: (row.attachment as Row).mimetype,
          size: (row.attachment as Row).size,
        }
      : null,
  }))
}
async function setPrimary(ctx: Ctx, items: Row[], id: unknown, key: string, now: string) {
  for (const image of items.filter((row) => row.primary && row.id !== id))
    await ctx.db.update(
      'hospitality_core.ContentImage',
      { id: image.id },
      { primary: false, primarySlot: null, updatedAt: now },
    )
  await ctx.db.update(
    'hospitality_core.ContentImage',
    { id },
    { primary: true, primarySlot: key, updatedAt: now },
  )
}
function metadata(args: Args) {
  const category = String(args.category ?? ''),
    caption = String(args.caption ?? '').trim()
  if (!(CONTENT_IMAGE_CATEGORIES as readonly string[]).includes(category))
    reject('category', 'content_category')
  if (caption.length > 120) reject('caption', 'content_caption')
  return { category, caption: caption || null }
}

/** One property version fences the complete ordered collection, including upload and primary swaps. */
async function command(ctx: Ctx, args: Args, action: string) {
  return runCommand(ctx, args, action, async (tx) => {
    if (!Number.isInteger(args.expectedPropertyVersion) || Number(args.expectedPropertyVersion) < 0)
      reject('expectedPropertyVersion', 'transition_conflict')
    if (!String(args.requestKey ?? '').trim()) reject('requestKey', 'request_key')
    const image = ['updateContentImage', 'setPrimaryContentImage', 'removeContentImage'].includes(action)
      ? await readRecord(tx, 'hospitality_core.ContentImage', args.id)
      : null
    if (['updateContentImage', 'setPrimaryContentImage', 'removeContentImage'].includes(action) && !image)
      reject('id', 'record_missing')
    const selected = await target(tx, image ?? args),
      items = await rows(tx, selected),
      now = new Date().toISOString()
    await claimVersion(tx, 'hospitality_core.Property', selected.property, args.expectedPropertyVersion)
    let saved: Row | undefined
    if (action === 'attachContentImage') {
      if (items.length >= 30) reject('id', 'content_image_limit')
      if (
        items.some((row) => row.attachmentId === args.attachmentId) ||
        (await readRecord(tx, 'hospitality_core.ContentImage', args.id))
      )
        reject('id', 'transition_conflict')
      const attachment = await readRecord(tx, 'storage.Attachment', args.attachmentId)
      if (
        !attachment ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(String(attachment.mimetype)) ||
        Number(attachment.size) <= 0 ||
        Number(attachment.size) > 10 * 1024 * 1024
      )
        reject('attachmentId', 'content_image')
      const evidence = await readRecord(tx, 'hospitality_core.ContentImageEvidence', attachment.id)
      if (
        !evidence ||
        evidence.checksum !== attachment.checksum ||
        evidence.mimetype !== attachment.mimetype ||
        Number(evidence.width) < 1024 ||
        Number(evidence.height) < 1024
      )
        reject('attachmentId', 'content_image')
      if (
        attachment.resModel !==
          (selected.roomType ? 'hospitality_core.RoomType' : 'hospitality_core.Property') ||
        attachment.resId !== (selected.roomType?.id ?? selected.property.id)
      )
        reject('attachmentId', 'content_target')
      const sequence = Number(args.sequence ?? Number(items.at(-1)?.sequence ?? 0) + 10)
      if (!Number.isSafeInteger(sequence) || sequence < 0) reject('sequence', 'content_order')
      const primary = !items.length || args.primary === true
      // Release the unique slot before inserting the replacement primary.
      if (primary)
        for (const prior of items.filter((row) => row.primary))
          await tx.db.update(
            'hospitality_core.ContentImage',
            { id: prior.id },
            { primary: false, primarySlot: null, updatedAt: now },
          )
      saved = {
        id: args.id,
        attachmentId: attachment.id,
        propertyId: selected.roomType ? null : selected.property.id,
        roomTypeId: selected.roomType?.id ?? null,
        targetKey: selected.key,
        primarySlot: primary ? selected.key : null,
        primary,
        sequence,
        ...metadata(args),
        createdAt: now,
        updatedAt: now,
      }
      await tx.db.insert('hospitality_core.ContentImage', saved)
      // Publish only after verified headers, target ownership and the collection claim succeed.
      await tx.db.update('storage.Attachment', { id: attachment.id }, { public: true })
      await tx.jobs.enqueue(
        'storage.publish',
        { id: attachment.id },
        { uniqueKey: `attachment:${attachment.id}` },
      )
    } else if (action === 'updateContentImage') {
      saved = { ...image!, ...metadata(args), updatedAt: now }
      await tx.db.update(
        'hospitality_core.ContentImage',
        { id: image!.id },
        { ...metadata(args), updatedAt: now },
      )
    } else if (action === 'setPrimaryContentImage') {
      await setPrimary(tx, items, image!.id, selected.key, now)
    } else if (action === 'reorderContentImages') {
      const ids = Array.isArray(args.ids) ? args.ids : []
      if (
        ids.length !== items.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !items.some((row) => row.id === id))
      )
        reject('ids', 'content_order')
      for (let i = 0; i < ids.length; i++)
        await tx.db.update(
          'hospitality_core.ContentImage',
          { id: ids[i] },
          { sequence: (i + 1) * 10, updatedAt: now },
        )
    } else {
      if (image!.primary) reject('id', 'content_primary')
      for (const [model, field, id] of [
        ['hospitality_core.ContentImage', 'id', image!.id],
        ['storage.AttachmentRendition', 'attachmentId', image!.attachmentId],
        ['storage.Attachment', 'id', image!.attachmentId],
      ] as Array<[string, string, unknown]>) {
        const T = tx.table(model!)
        await tx.db.del(deleteFrom(T).where(eq(T[field!]!, id), eq(T.companyId!, tx.scope.company)))
      }
      await tx.jobs.enqueue('storage.sweep', { minAgeMs: 0 }, { uniqueKey: `company:${tx.scope.company}` })
    }
    await appendContentChange(tx, {
      propertyId: selected.property.id,
      resourceType:
        action === 'reorderContentImages' ? (selected.roomType ? 'room_type' : 'property') : 'image',
      resourceId: args.id ?? selected.roomType?.id ?? selected.property.id,
      kind:
        action === 'removeContentImage' ? 'delete' : action === 'reorderContentImages' ? 'reorder' : 'upsert',
    })
    await recordChange(tx, selected.property.id, args.id ?? selected.key, `content-image-${action}`, {
      target: selected.key,
      ...(action === 'updateContentImage'
        ? { previous: { category: image!.category, caption: image!.caption }, next: metadata(args) }
        : {}),
    })
    return { ok: true, id: args.id, ...(saved ?? {}) }
  })
}

export const contentImageFunctions: Record<string, FnSpec> = {
  listContentImages: defineFn({
    input: { propertyId: 'id?', roomTypeId: 'id?' },
    output: {
      id: 'id',
      attachmentId: 'id',
      propertyId: 'id?',
      roomTypeId: 'id?',
      category: 'text',
      caption: 'text?',
      sequence: 'int',
      primary: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
      attachment: 'json?',
    },
    effects: reads,
    agent: true,
    handler: listContentImages,
  }),
  attachContentImage: defineFn({
    input: {
      ...fence,
      id: 'id',
      attachmentId: 'id',
      propertyId: 'id?',
      roomTypeId: 'id?',
      category: 'text',
      caption: 'text?',
      sequence: 'int?',
      primary: 'bool?',
    },
    output: result,
    effects: [...writes, 'write:storage.Attachment', 'enqueue:storage.publish'],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => command(ctx, args, 'attachContentImage'),
  }),
  updateContentImage: defineFn({
    input: { ...fence, id: 'id', category: 'text', caption: 'text?' },
    output: result,
    effects: writes,
    idempotent: true,
    agent: true,
    handler: (ctx, args) => command(ctx, args, 'updateContentImage'),
  }),
  setPrimaryContentImage: defineFn({
    input: { ...fence, id: 'id' },
    output: result,
    effects: writes,
    idempotent: true,
    agent: true,
    handler: (ctx, args) => command(ctx, args, 'setPrimaryContentImage'),
  }),
  reorderContentImages: defineFn({
    input: { ...fence, propertyId: 'id?', roomTypeId: 'id?', ids: 'json' },
    output: result,
    effects: writes,
    idempotent: true,
    agent: true,
    handler: (ctx, args) => command(ctx, args, 'reorderContentImages'),
  }),
  removeContentImage: defineFn({
    input: { ...fence, id: 'id' },
    output: result,
    effects: [
      ...writes,
      'write:storage.Attachment',
      'write:storage.AttachmentRendition',
      'enqueue:storage.sweep',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => command(ctx, args, 'removeContentImage'),
  }),
}
