import { salesConfiguration } from '../sale/configuration.ts'
import { createOrder } from '../sale/create-order.ts'
import { effectiveFunctionKeys } from '../user/authorization.ts'
import { randomUUID, createHash } from 'node:crypto'
import { deleteFrom, eq } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { compareDecimals } from '../account/money.ts'
import { sellableProduct } from '../product/sellable.ts'
import { ours, companyKey } from '../sale/scope.ts'
import { claimRevision, recompute, refreshStatus, SaleRefused } from '../sale/functions/shared.ts'
import { writeQuotationLine, replaceQuotationLines } from '../sale/functions/lines.ts'
import { automaticLinePrice } from '../sale/automatic-price.ts'
import { resizeComboDemand } from '../sale/combo-demand.ts'
import { InventoryRefused } from '../stock/inventory-validation.ts'
import { saleRecordResult } from '../sale/record-result.ts'
import { templateAudience, canUseTemplate, hasTemplateGrant } from './access.ts'
export const refused = (field: string, code: string, params: Row = {}) => ({
  ok: false,
  errors: [{ field, code: 'sale_template.error.' + code, params }],
})
function abort(field: string, code: string, params: Row = {}): never {
  throw new SaleRefused(refused(field, code, params))
}
const ordered = (a: Row, b: Row) =>
  Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id))
const keyOf = (name: unknown) =>
  String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi')
const nameOf = (name: unknown) =>
  String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
async function transaction(ctx: Ctx, body: (tx: Ctx) => Promise<Row>) {
  try {
    return await ctx.tx(body)
  } catch (error) {
    if (error instanceof SaleRefused || error instanceof InventoryRefused)
      return saleRecordResult(error.result)
    throw error
  }
}
/** A no-op row lock serializes template names, overwrites and lifecycle writes in this company. */
async function lockNamespace(ctx: Ctx) {
  const id = companyKey(ctx, 'sale-template')
  await ctx.db.insertIfAbsent('sale_template.Namespace', { id, revision: 0 })
  const held = await ctx.db.compareAndSet('sale_template.Namespace', { id }, { revision: 0 }, { revision: 0 })
  if (!('dryRun' in held) && !held.matched) abort('expectedRevision', 'changed')
}
async function removeChildren(ctx: Ctx, model: string, field: string, id: unknown) {
  const table = ctx.table(model)
  await ctx.db.del(deleteFrom(table).where(eq(table[field], String(id))))
}
async function validateLines(ctx: Ctx, kind: string, input: unknown): Promise<Row[]> {
  if (!Array.isArray(input) || !input.length || input.length > (kind === 'section' ? 99 : 100))
    abort('lines', 'lines')
  const lines: Row[] = []
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) abort('lines', 'lines')
    const type = item.displayType ?? null,
      name = String(item.name ?? '').trim()
    const field = 'lines.' + index
    if (type) {
      if (
        !['section', 'note'].includes(type) ||
        !name ||
        name.length > 2000 ||
        item.productId ||
        item.optional ||
        (kind === 'section' && type === 'section')
      )
        abort(field, 'line', { line: name || String(index + 1) })
      lines.push({
        displayType: type,
        name,
        productId: null,
        productUomId: null,
        productUomQty: '0',
        optional: false,
        sequence: (index + 1) * 100,
      })
      continue
    }
    if (typeof item.productUomQty !== 'string') abort(field, 'line', { line: name || String(index + 1) })
    try {
      if (compareDecimals(item.productUomQty, '0') < 0)
        abort(field, 'line', { line: name || String(index + 1) })
    } catch (error) {
      if (error instanceof SaleRefused) throw error
      abort(field, 'line', { line: name || String(index + 1) })
    }
    if (kind === 'section' && item.optional) abort(field, 'line', { line: name || String(index + 1) })
    const product = await sellableProduct(ctx, item.productId, item.productUomId, {
      allowCombo: kind === 'quotation',
    })
    if (
      !product.ok ||
      (product.value.template.companyId && product.value.template.companyId !== ctx.scope.company) ||
      (product.value.product.companyId && product.value.product.companyId !== ctx.scope.company)
    )
      abort(field, 'line', { line: name || String(index + 1) })
    lines.push({
      displayType: null,
      name: name || null,
      productId: item.productId,
      productUomId: item.productUomId || product.value.template.uomId,
      productUomQty: item.productUomQty,
      optional: item.optional === true,
      sequence: (index + 1) * 100,
    })
  }
  if (!lines.some((line) => line.productId && !line.optional)) abort('lines', 'productRequired')
  return lines
}
async function teamsOf(ctx: Ctx, input: unknown) {
  if (
    !Array.isArray(input) ||
    input.length > 100 ||
    input.some((id) => typeof id !== 'string') ||
    new Set(input).size !== input.length
  )
    abort('teamIds', 'teams')
  const teams = await ours(ctx, 'crm.Team')
  if (input.some((id) => !teams.some((team) => team.id === id))) abort('teamIds', 'teams')
  return input as string[]
}
async function writeTemplate(ctx: Ctx, record: Row, lines: Row[], teamIds: string[], existing?: Row) {
  const name = nameOf(record.name),
    nameKey = keyOf(name)
  if (!name || name.length > 80) abort('name', 'name')
  const ownerKey = record.kind === 'section' ? record.ownerId : ''
  const duplicate = (
    await ours(ctx, 'sale_template.Template', { kind: record.kind, ownerKey, nameKey })
  ).find((row) => row.id !== record.id)
  if (duplicate) abort('name', 'duplicate')
  if (existing) {
    const held = await ctx.db.compareAndSet(
      'sale_template.Template',
      { id: existing.id },
      { revision: record.revision },
      { ...record, name, nameKey, ownerKey, revision: Number(record.revision) + 1 },
    )
    if (!('dryRun' in held) && !held.matched) abort('expectedRevision', 'changed')
  } else await ctx.db.insert('sale_template.Template', { ...record, name, nameKey, ownerKey, revision: 1 })
  await removeChildren(ctx, 'sale_template.Line', 'templateId', record.id)
  await removeChildren(ctx, 'sale_template.Team', 'templateId', record.id)
  for (const line of lines)
    await ctx.db.insert('sale_template.Line', { ...line, id: randomUUID(), templateId: record.id })
  for (const teamId of teamIds)
    await ctx.db.insert('sale_template.Team', { id: randomUUID(), templateId: record.id, teamId })
  return { ok: true, id: record.id, revision: existing ? Number(record.revision) + 1 : 1 }
}
type TemplateData = Row & { ownerName: string; lines: Row[]; teamIds: unknown[] }
export async function templateData(ctx: Ctx, id: unknown, manage = false): Promise<TemplateData | null> {
  const row = (await ours(ctx, 'sale_template.Template', { id }))[0]
  if (!row || (!(manage && (await templateAudience(ctx)).manager) && !(await canUseTemplate(ctx, row))))
    return null
  const [lines, assignments, owner] = await Promise.all([
    ours(ctx, 'sale_template.Line', { templateId: id }),
    ours(ctx, 'sale_template.Team', { templateId: id }),
    ctx.db.select('user.User', { id: row.ownerId }),
  ])
  return {
    ...row,
    ownerName: String(owner[0]?.name ?? ''),
    lines: lines.sort(ordered),
    teamIds: assignments.map((team) => team.teamId),
  }
}
export async function listTemplates(ctx: Ctx, args: Row) {
  const audience = await templateAudience(ctx),
    manage = args.manage === true && audience.manager
  const [templates, assignments, teams] = await Promise.all([
    ours(ctx, 'sale_template.Template'),
    ours(ctx, 'sale_template.Team'),
    ours(ctx, 'crm.Team'),
  ])
  const search = (value: unknown) =>
    keyOf(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
  const visible = templates
    .filter((row) => {
      if (
        (args.id && row.id !== args.id) ||
        (args.kind && row.kind !== args.kind) ||
        (!manage && !row.active) ||
        (args.active !== undefined && row.active !== args.active)
      )
        return false
      const allowed = assignments.filter((team) => team.templateId === row.id)
      if (
        !manage &&
        !audience.manager &&
        allowed.length &&
        !allowed.some((team) => audience.teams.includes(String(team.teamId)))
      )
        return false
      return !args.search || search(row.name).includes(search(args.search))
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
  const offset = Math.max(0, Number(args.offset) || 0),
    limit = Math.min(100, Math.max(1, Number(args.limit) || 25))
  const rows: Row[] = [],
    owners = new Map<unknown, string>()
  for (const row of visible.slice(offset, offset + limit)) {
    if (!owners.has(row.ownerId)) {
      const owner = (await ctx.db.select('user.User', { id: row.ownerId }))[0]
      owners.set(row.ownerId, String(owner?.name ?? ''))
    }
    const ownerName = owners.get(row.ownerId)!,
      assigned = assignments.filter((team) => team.templateId === row.id)
    rows.push({
      ...row,
      ownerName,
      teamIds: assigned.map((team) => team.teamId),
      teamNames: assigned.map((team) =>
        String(teams.find((candidate) => candidate.id === team.teamId)?.name ?? ''),
      ),
      displayName:
        row.kind === 'section' && visible.filter((other) => keyOf(other.name) === keyOf(row.name)).length > 1
          ? String(row.name) + ' · ' + ownerName
          : String(row.name),
    })
  }
  return { rows, total: visible.length, offset }
}
export async function saveTemplate(ctx: Ctx, args: Row) {
  return transaction(ctx, async (tx) => {
    if (!(await hasTemplateGrant(tx, 'saveTemplate'))) abort('id', 'permission')
    await lockNamespace(tx)
    const existing = (await ours(tx, 'sale_template.Template', { id: args.id }))[0]
    if (
      (existing && Number(existing.revision) !== Number(args.expectedRevision)) ||
      (!existing && Number(args.expectedRevision) !== 0)
    )
      abort('expectedRevision', 'changed')
    const kind = args.kind ?? existing?.kind ?? 'quotation'
    if (!['quotation', 'section'].includes(String(kind)) || (existing && kind !== existing.kind))
      abort('kind', 'kind')
    const lines = await validateLines(tx, String(kind), args.lines),
      teams = await teamsOf(tx, args.teamIds ?? [])
    const days = args.validityDays == null ? null : Number(args.validityDays)
    if (kind === 'quotation' && days !== null && (!Number.isInteger(days) || days < 1 || days > 365))
      abort('validityDays', 'days')
    const percent = String(args.prepaymentPercent ?? '100')
    try {
      if (compareDecimals(percent, '0') < 0 || compareDecimals(percent, '100') > 0)
        abort('prepaymentPercent', 'percent')
    } catch (error) {
      if (error instanceof SaleRefused) throw error
      abort('prepaymentPercent', 'percent')
    }
    if (
      kind === 'section' &&
      (args.notes || args.validityDays != null || args.requireSignature || args.requirePayment)
    )
      abort('kind', 'sectionOnly')
    return writeTemplate(
      tx,
      {
        id: args.id,
        name: args.name,
        kind,
        ownerId: existing?.ownerId ?? ctx.actor,
        active: args.active ?? existing?.active ?? true,
        revision: args.expectedRevision,
        validityDays: kind === 'quotation' ? days : null,
        notes: kind === 'quotation' ? (args.notes ?? null) : null,
        requireSignature: kind === 'quotation' ? args.requireSignature === true : null,
        requirePayment: kind === 'quotation' ? args.requirePayment === true : null,
        prepaymentPercent: kind === 'quotation' ? percent : null,
      },
      lines,
      teams,
      existing,
    )
  })
}
export async function sectionSource(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order || order.state === 'cancel') return null
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId: order.id })).sort(ordered)
  const start = lines.findIndex((line) => line.id === args.sectionId && line.displayType === 'section')
  if (start < 0) return null
  let end = lines.findIndex((line, index) => index > start && line.displayType === 'section')
  if (end < 0) end = lines.length
  const section = lines[start]!,
    children = lines.slice(start + 1, end)
  if (children.some((line) => line.comboParentId))
    abort('sectionId', 'line', { line: children.find((line) => line.comboParentId)!.name })
  const existing = (
    await ours(ctx, 'sale_template.Template', {
      kind: 'section',
      ownerKey: ctx.actor,
      nameKey: keyOf(section.name),
    })
  )[0]
  return {
    order,
    section,
    lines: children,
    existing: existing
      ? { id: existing.id, name: existing.name, revision: existing.revision, active: existing.active }
      : null,
  }
}
export async function saveSection(ctx: Ctx, args: Row) {
  return transaction(ctx, async (tx) => {
    if (!ctx.actor) abort('id', 'permission')
    await lockNamespace(tx)
    const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
    if (!order || Number(order.revision) !== Number(args.expectedRevision))
      abort('expectedRevision', 'changed')
    const held = await tx.db.compareAndSet(
      'sale.Order',
      { id: args.id },
      { revision: order.revision },
      { revision: order.revision },
    )
    if (!('dryRun' in held) && !held.matched) abort('expectedRevision', 'changed')
    const source = await sectionSource(tx, args)
    if (!source || Number(source.order.revision) !== Number(args.expectedRevision))
      abort('expectedRevision', 'changed')
    if (
      (source.existing &&
        (!args.overwrite || Number(source.existing.revision) !== Number(args.expectedTemplateRevision))) ||
      (!source.existing && Number(args.expectedTemplateRevision) !== 0)
    )
      abort('overwrite', 'overwrite')
    const lines = await validateLines(tx, 'section', source.lines)
    const current = source.existing
      ? (await ours(tx, 'sale_template.Template', { id: source.existing.id }))[0]
      : undefined
    const id =
      current?.id ??
      createHash('sha256')
        .update(JSON.stringify([ctx.scope.company, ctx.actor, keyOf(source.section.name)]))
        .digest('hex')
    const teams = current
      ? (await ours(tx, 'sale_template.Team', { templateId: id })).map((row) => String(row.teamId))
      : (await templateAudience(tx)).teams
    return writeTemplate(
      tx,
      {
        id,
        name: source.section.name,
        kind: 'section',
        ownerId: ctx.actor,
        active: true,
        revision: current?.revision ?? 0,
        validityDays: null,
        notes: null,
        requireSignature: null,
        requirePayment: null,
        prepaymentPercent: null,
      },
      lines,
      teams,
      current,
    )
  })
}
export async function applyTemplate(ctx: Ctx, args: Row, section: boolean) {
  return transaction(ctx, (tx) => applyTemplateInTransaction(tx, args, section))
}

export async function applyTemplateInTransaction(tx: Ctx, args: Row, section: boolean) {
  await lockNamespace(tx)
  const template = await templateData(tx, args.templateId)
  if (!template || template.kind !== (section ? 'section' : 'quotation')) abort('templateId', 'unavailable')
  if (
    args.expectedTemplateRevision != null &&
    Number(template.revision) !== Number(args.expectedTemplateRevision)
  )
    abort('expectedTemplateRevision', 'changed')
  const order = (await ours(tx, 'sale.Order', { id: args.id }))[0]
  if (
    !order ||
    order.locked ||
    !(section ? ['draft', 'sent', 'sale'] : ['draft', 'sent']).includes(String(order.state)) ||
    (order.orderAuthority && order.orderAuthority !== 'local')
  )
    abort('id', 'order')
  if (Number(order.revision) !== Number(args.expectedRevision)) abort('expectedRevision', 'changed')
  const existing = await ours(tx, 'sale.OrderLine', { orderId: order.id })
  const lines = await validateLines(tx, String(template.kind), template.lines)
  const ordinary = lines.filter((line) => !line.optional)
  if (section && existing.length + ordinary.length + 1 > 100) abort('lines', 'tooMany')
  if (!section && existing.length && args.replace !== true) abort('replace', 'replace')
  if (!(await claimRevision(tx, order, args.expectedRevision))) abort('expectedRevision', 'changed')
  if (section) {
    let sequence = Math.max(0, ...existing.map((line) => Number(line.sequence)))
    const add = [{ displayType: 'section', name: template.name, productUomQty: '0' }, ...ordinary]
    for (const line of add) {
      const draft: Row = {
        ...line,
        id: randomUUID(),
        orderId: order.id,
        sequence: (sequence += 100),
        priceAutomatic: true,
      }
      if (draft.productId) {
        const price = await automaticLinePrice(tx, order, draft, draft.productUomQty)
        if (!price.ok) throw new SaleRefused(price)
        draft.priceUnit = price.priceUnit
      }
      const result = await writeQuotationLine(tx, draft, undefined, [], undefined, true)
      if (!result.ok) throw new SaleRefused(result)
      if (order.state === 'sale' && draft.productId) {
        const fresh = (await ours(tx, 'sale.Order', { id: order.id }))[0]!,
          saved = (await ours(tx, 'sale.OrderLine', { id: draft.id }))[0]!
        await resizeComboDemand(tx, fresh, [saved], draft.productUomQty)
      }
    }
  } else {
    await replaceQuotationLines(
      tx,
      order.id,
      ordinary.map((line) => ({ ...line, id: randomUUID(), priceAutomatic: true })),
    )
    await removeChildren(tx, 'sale_template.OrderOption', 'orderId', order.id)
    for (const line of lines.filter((line) => line.optional))
      await tx.db.insert('sale_template.OrderOption', {
        id: randomUUID(),
        orderId: order.id,
        sequence: line.sequence,
        productId: line.productId,
        productUomId: line.productUomId,
        productUomQty: line.productUomQty,
      })
    await tx.db.update(
      'sale.Order',
      { id: order.id },
      {
        notes: template.notes,
        validityDate: template.validityDays
          ? new Date(
              Date.parse(String(order.dateOrder)) + Number(template.validityDays) * 86400000,
            ).toISOString()
          : null,
        templateSignature: template.requireSignature,
        templatePayment: template.requirePayment,
        templatePrepaymentPercent: template.prepaymentPercent,
      },
    )
  }
  await recompute(tx, order.id)
  await refreshStatus(tx, order.id)
  return { ok: true, id: order.id, revision: (await ours(tx, 'sale.Order', { id: order.id }))[0]!.revision }
}

export async function createQuotation(ctx: Ctx, args: Row) {
  return transaction(ctx, (tx) => createQuotationInTransaction(tx, args))
}

/** Create and apply a template within a caller-owned transaction. */
export async function createQuotationInTransaction(tx: Ctx, args: Row) {
  const keys = tx.actor ? await effectiveFunctionKeys(tx, tx.actor) : []
  if (keys !== null && !keys.includes('sale.createOrder')) abort('id', 'permission')
  await lockNamespace(tx)
  // A replay must never replace lines on an already-created order.
  const existing = (await ours(tx, 'sale.Order', { id: args.id }))[0]
  if (existing) return { ok: true, id: existing.id, name: existing.name }
  const created = await createOrder(tx, args)
  if (!created.ok) throw new SaleRefused(created)
  if (args.templateId) {
    await applyTemplateInTransaction(tx, { ...args, expectedRevision: 0, replace: false }, false)
  } else {
    // Without a template, the quotation asks for what the company's settings ask for (D20).
    const config = await salesConfiguration(tx)
    await tx.db.update(
      'sale.Order',
      { id: args.id },
      {
        templateSignature: config.onlineSignature,
        templatePayment: config.onlinePayment,
        templatePrepaymentPercent: config.onlinePayment ? config.prepaymentPercent : null,
      },
    )
  }
  return created
}

export async function setTemplateActive(ctx: Ctx, args: Row) {
  return transaction(ctx, async (tx) => {
    if (!(await hasTemplateGrant(tx, 'setTemplateActive'))) abort('id', 'permission')
    await lockNamespace(tx)
    const template = (await ours(tx, 'sale_template.Template', { id: args.id }))[0]
    if (!template || Number(template.revision) !== Number(args.expectedRevision))
      abort('expectedRevision', 'changed')
    if (template.active === args.active) return { ok: true, id: template.id, revision: template.revision }
    const held = await tx.db.compareAndSet(
      'sale_template.Template',
      { id: args.id },
      { revision: args.expectedRevision },
      { active: args.active, revision: Number(template.revision) + 1 },
    )
    if (!('dryRun' in held) && !held.matched) abort('expectedRevision', 'changed')
    return { ok: true, id: template.id, revision: Number(template.revision) + 1 }
  })
}
