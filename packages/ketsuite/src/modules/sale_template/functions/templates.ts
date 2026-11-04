import { ordersFunctions } from '../../sale/functions/orders.ts'
import { variantsFunctions, queryVariants } from '../../product/functions/variants.ts'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { catalogueQuantityFunctions } from '../../sale/functions/catalogue-quantity.ts'
import { ours } from '../../sale/scope.ts'
import { SaleRefused } from '../../sale/functions/shared.ts'
import { saleRecordResult } from '../../sale/record-result.ts'
import { accessEffects, templateAudience } from '../access.ts'
import {
  templateData,
  listTemplates,
  saveTemplate,
  sectionSource,
  saveSection,
  applyTemplate,
  createQuotation,
  setTemplateActive,
} from '../domain.ts'
export const readEffects = [
  ...accessEffects,
  'read:sale_template.Template',
  'read:sale_template.Line',
  'read:sale_template.Team',
  'read:sale_template.OrderOption',
  'read:sale.Order',
  'read:sale.OrderLine',
  'read:product.Product',
  'read:product.Template',
  'read:uom.Unit',
]
const writeEffects = [
  ...readEffects,
  ...catalogueQuantityFunctions.setCatalogueQuantity.effects!,
  'read:sale_template.Namespace',
  'write:sale_template.Namespace',
  'write:sale_template.Template',
  'write:sale_template.Line',
  'write:sale_template.Team',
  'write:sale_template.OrderOption',
]
const commandOutput = { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' } as const
async function preview(ctx: Ctx, args: Row) {
  try {
    return { ok: true, source: await sectionSource(ctx, args) }
  } catch (error) {
    if (error instanceof SaleRefused) return saleRecordResult(error.result)
    throw error
  }
}
async function listChoicesHandler(ctx: Ctx, args: Row) {
  return (await listTemplates(ctx, args)).rows
}
async function searchProductsHandler(ctx: Ctx, args: Row) {
  const rows = (await queryVariants(ctx, {
    saleOk: true,
    active: true,
    requireUom: true,
    search: args.search,
  })) as Array<Row & { template: Row }>
  return rows
    .filter(
      (row) =>
        (!row.companyId || row.companyId === ctx.scope.company) &&
        (args.kind !== 'section' || row.template.type !== 'combo'),
    )
    .slice(0, Math.min(100, Number(args.limit) || 25))
    .map((row) => ({
      id: row.id,
      name: row.displayName ?? row.name,
      defaultCode: row.defaultCode,
      uomId: row.template.uomId,
    }))
}
async function sectionChoicesHandler(ctx: Ctx, args: Row) {
  const order = (await ours(ctx, 'sale.Order', { id: args.id }))[0]
  if (!order) return null
  const lines = (await ours(ctx, 'sale.OrderLine', { orderId: args.id })).sort(
    (a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)),
  )
  const own = ctx.actor
    ? await ours(ctx, 'sale_template.Template', { kind: 'section', ownerKey: ctx.actor })
    : []
  return lines.flatMap((section, index) => {
    if (section.displayType !== 'section') return []
    let end = lines.findIndex((line, next) => next > index && line.displayType === 'section')
    if (end < 0) end = lines.length
    if (!lines.slice(index + 1, end).some((line) => line.productId && !line.comboParentId)) return []
    const key = (value: unknown) =>
      String(value ?? '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('vi')
    const existing = own.find((row) => row.nameKey === key(section.name))
    return [
      {
        id: section.id,
        name: section.name,
        existing: existing ? { id: existing.id, revision: existing.revision, active: existing.active } : null,
      },
    ]
  })
}
function getTemplateHandler(ctx: Ctx, args: Row) {
  return templateData(ctx, args.id, args.manage === true)
}
async function getSetupHandler(ctx: Ctx) {
  return {
    audience: await templateAudience(ctx),
    teams: (await ours(ctx, 'crm.Team')).map((row) => ({ id: row.id, name: row.name, active: row.active })),
    units: (await ctx.db.select('uom.Unit')).map((row) => ({ id: row.id, name: row.name })),
  }
}
function addSectionHandler(ctx: Ctx, args: Row) {
  return applyTemplate(ctx, args, true)
}
function applyQuotationHandler(ctx: Ctx, args: Row) {
  return applyTemplate(ctx, args, false)
}
export const templateFunctions = {
  setTemplateActive: defineFn({
    input: { id: 'id', expectedRevision: 'int', active: 'bool' },
    output: commandOutput,
    effects: writeEffects,
    handler: setTemplateActive,
    idempotent: true,
  }),
  createQuotation: defineFn({
    input: { ...ordersFunctions.createOrder!.input, templateId: 'id?' },
    output: commandOutput,
    effects: [...writeEffects, ...ordersFunctions.createOrder!.effects!],
    handler: createQuotation,
    idempotent: true,
    agent: true,
  }),
  listChoices: defineFn({
    input: { kind: 'text', search: 'text?', limit: 'int?', id: 'id?' },
    effects: readEffects,
    handler: listChoicesHandler,
  }),
  searchProducts: defineFn({
    input: { kind: 'text', search: 'text?', limit: 'int?' },
    effects: [...readEffects, ...variantsFunctions.listVariants!.effects!],
    handler: searchProductsHandler,
  }),
  sectionChoices: defineFn({ input: { id: 'id' }, effects: readEffects, handler: sectionChoicesHandler }),
  listTemplates: defineFn({
    input: {
      kind: 'text?',
      search: 'text?',
      active: 'bool?',
      manage: 'bool?',
      offset: 'int?',
      limit: 'int?',
    },
    effects: readEffects,
    handler: listTemplates,
    agent: true,
  }),
  getTemplate: defineFn({
    input: { id: 'id', manage: 'bool?' },
    effects: readEffects,
    handler: getTemplateHandler,
    agent: true,
  }),
  getSetup: defineFn({ input: {}, effects: readEffects, handler: getSetupHandler }),
  saveTemplate: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      kind: 'text?',
      name: 'text',
      active: 'bool?',
      teamIds: 'json?',
      lines: 'json',
      validityDays: 'int?',
      notes: 'text?',
      requireSignature: 'bool?',
      requirePayment: 'bool?',
      prepaymentPercent: 'decimal?',
    },
    output: commandOutput,
    effects: writeEffects,
    handler: saveTemplate,
    idempotent: true,
    agent: true,
  }),
  previewSection: defineFn({ input: { id: 'id', sectionId: 'id' }, effects: readEffects, handler: preview }),
  saveSection: defineFn({
    input: {
      id: 'id',
      sectionId: 'id',
      expectedRevision: 'int',
      expectedTemplateRevision: 'int',
      overwrite: 'bool?',
    },
    output: commandOutput,
    effects: writeEffects,
    handler: saveSection,
    idempotent: true,
    agent: true,
  }),
  addSection: defineFn({
    input: { id: 'id', templateId: 'id', expectedRevision: 'int', expectedTemplateRevision: 'int?' },
    output: commandOutput,
    effects: writeEffects,
    handler: addSectionHandler,
    idempotent: true,
    agent: true,
  }),
  applyQuotation: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      expectedRevision: 'int',
      expectedTemplateRevision: 'int?',
      replace: 'bool?',
    },
    output: commandOutput,
    effects: writeEffects,
    handler: applyQuotationHandler,
    idempotent: true,
    agent: true,
  }),
}
