import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import { getOrderTags, listTags, saveTag, setOrderTags, setTagActive } from '../tags.ts'
import { saleRecordResult } from '../record-result.ts'

const TAG_EFFECTS = ['read:sale.Tag', 'write:sale.Tag'] as const
const READ_EFFECTS = ['read:sale.Tag', 'read:sale.OrderTag'] as const

export const saveTagHandler = async (ctx: Ctx, args: Row) => saleRecordResult(await saveTag(ctx, args))
export const setTagActiveHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await setTagActive(ctx, args))
export const listTagsHandler = (ctx: Ctx, args: Row) => listTags(ctx, args)
export const getOrderTagsHandler = (ctx: Ctx, args: Row) => getOrderTags(ctx, args)
export const setOrderTagsHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await setOrderTags(ctx, args))

export const tagFunctions: Record<string, FnSpec> = {
  saveTag: defineFn({
    input: { id: 'id', name: 'text', expectedRevisionId: 'text?' },
    output: { ok: 'bool', id: 'id?', revisionId: 'text?', errors: 'json?' },
    effects: [...TAG_EFFECTS],
    idempotent: true,
    agent: true,
    handler: saveTagHandler,
  }),
  setTagActive: defineFn({
    input: { id: 'id', active: 'bool', expectedRevisionId: 'text' },
    output: { ok: 'bool', id: 'id?', revisionId: 'text?', errors: 'json?' },
    effects: [...TAG_EFFECTS],
    idempotent: true,
    agent: true,
    handler: setTagActiveHandler,
  }),
  listTags: defineFn({
    input: { includeArchived: 'bool?', ids: 'json?' },
    effects: [...READ_EFFECTS],
    agent: true,
    handler: listTagsHandler,
  }),
  getOrderTags: defineFn({
    input: { id: 'id' },
    effects: [...READ_EFFECTS, 'read:sale.Order'],
    agent: true,
    handler: getOrderTagsHandler,
  }),
  setOrderTags: defineFn({
    input: { id: 'id', tagIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...READ_EFFECTS, 'read:sale.Order', 'write:sale.Tag', 'write:sale.OrderTag'],
    idempotent: true,
    agent: true,
    handler: setOrderTagsHandler,
  }),
}
