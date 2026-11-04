import { rewardTerms } from './reward-summary.ts'
import { ensureLoyaltyWallet } from '../loyalty/order-functions.ts'
import { postDelta } from '../loyalty/ledger.ts'
import { randomUUID } from 'node:crypto'
import { deleteFrom, eq, isDateText, type Ctx, type Row } from '@ketvietlab/ketjs'
import { canonicalDecimalText, compareDecimals } from '../account/money.ts'
import { companyKey, ours } from '../sale/scope.ts'
import { SaleRefused } from '../sale/functions/shared.ts'
import { loyaltyTransaction } from './order-lifecycle.ts'

export const saleProgramKinds = [
  'promotion',
  'promo_code',
  'buy_x_get_y',
  'coupons',
  'next_order_coupons',
  'loyalty',
] as const
const counted = new Set(['promotion', 'promo_code', 'buy_x_get_y'])
const nameKey = (value: unknown) =>
  String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('vi')
const refuse = (field: string, code: string): never => {
  throw new SaleRefused({ ok: false, errors: [{ field, code: 'loyalty_sale.error.' + code }] })
}
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('values', 'invalid')
  return value as Row
}
function decimal(value: unknown, field: string, fallback: string, positive = false): string {
  let text: string
  try {
    text = canonicalDecimalText(String(value ?? fallback))
  } catch {
    return refuse(field, 'invalid')
  }
  if (compareDecimals(text, '0') < (positive ? 1 : 0) || compareDecimals(text, '1000000000000') > 0)
    refuse(field, 'invalid')
  return text
}
function date(value: unknown, field: string): string | null {
  if (value == null || value === '') return null
  if (!isDateText(value)) refuse(field, 'date')
  return String(value)
}
export async function claimSaleProgramNamespace(ctx: Ctx) {
  const id = companyKey(ctx, 'sale-promotions')
  await ctx.db.insertIfAbsent('loyalty.ProgramNamespace', { id, revision: 0 })
  const held = await ctx.db.compareAndSet(
    'loyalty.ProgramNamespace',
    { id },
    { revision: 0 },
    { revision: 0 },
  )
  if (!('dryRun' in held) && !held.matched) refuse('expectedRevision', 'changed')
}
const links = [
  ['pricelistIds', 'loyalty.ProgramPricelist', 'programId', 'pricelistId', 'pricing.Pricelist'],
  ['productIds', 'loyalty.RuleProduct', 'ruleId', 'productId', 'product.Product'],
  ['categoryIds', 'loyalty.RuleCategory', 'ruleId', 'categoryId', 'product.Category'],
  ['tagIds', 'loyalty.RuleTag', 'ruleId', 'tagId', 'product.Tag'],
  ['rewardProductIds', 'loyalty.RewardProduct', 'rewardId', 'productId', 'product.Product'],
] as const
async function reference(ctx: Ctx, model: string, id: unknown, field: string) {
  const rows =
    model.startsWith('product.') || model === 'partner.Partner'
      ? await ctx.db.select(model, { id })
      : await ours(ctx, model, { id })
  const row = rows.find((row) => !row.companyId || row.companyId === ctx.scope.company)
  if (!row || row.active === false) return refuse(field, 'reference')
  if (model === 'product.Product') {
    const template = (await ctx.db.select('product.Template', { id: row.templateId }))[0]
    if (
      !template ||
      template.active === false ||
      template.saleOk === false ||
      (template.companyId && template.companyId !== ctx.scope.company) ||
      (field === 'rewardProductId' && template.type === 'combo')
    )
      refuse(field, 'reference')
  }
  return row
}
async function claim(ctx: Ctx, id: string, expected: unknown) {
  const program = (await ours(ctx, 'loyalty.Program', { id }))[0]
  if (!program) refuse('id', 'missing')
  if (program.salePolicyVersion !== 1) refuse('id', 'legacy')
  if (expected !== Number(program.configVersion ?? 0)) refuse('expectedRevision', 'changed')
  const result = await ctx.db.compareAndSet(
    'loyalty.Program',
    { id, companyId: ctx.scope.company },
    { configVersion: program.configVersion },
    { configVersion: Number(program.configVersion) + 1 },
  )
  if (!('dryRun' in result) && !result.matched) refuse('expectedRevision', 'changed')
  return program
}
export async function saveProgram(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const values = record(args.values)
    const existing = args.id ? await claim(tx, String(args.id), args.expectedRevision) : null
    const id = existing ? String(existing.id) : randomUUID()
    const kind = String(values.programType ?? 'promotion')
    if (!saleProgramKinds.includes(kind as (typeof saleProgramKinds)[number]))
      refuse('programType', 'invalid')
    const name = String(values.name ?? '')
      .normalize('NFC')
      .trim()
    if (!name || name.length > 80) refuse('name', 'name')
    if (
      (await ours(tx, 'loyalty.Program')).some((row) => row.id !== id && nameKey(row.name) === nameKey(name))
    )
      refuse('name', 'duplicate')
    if (
      existing &&
      existing.programType !== kind &&
      (await ours(tx, 'loyalty.Wallet', { programId: id })).length
    )
      refuse('programType', 'cards')
    const startDate = date(values.startDate, 'startDate'),
      endDate = date(values.endDate, 'endDate')
    if (startDate && endDate && startDate > endDate) refuse('endDate', 'date')
    const maxUsage = values.maxUsage == null || values.maxUsage === '' ? null : Number(values.maxUsage)
    if (
      maxUsage !== null &&
      (!counted.has(kind) || !Number.isInteger(maxUsage) || maxUsage < 1 || maxUsage > 999999)
    )
      refuse('maxUsage', 'invalid')
    const code =
      kind === 'promo_code'
        ? String(values.code ?? '')
            .trim()
            .toUpperCase()
        : null
    if ((code && !/^[A-Z0-9_-]{3,30}$/.test(code)) || (kind === 'promo_code' && !code)) refuse('code', 'code')
    const rule = existing ? (await ours(tx, 'loyalty.Rule', { programId: id }))[0] : null
    const reward = existing ? (await ours(tx, 'loyalty.Reward', { programId: id }))[0] : null
    const ruleId = String(rule?.id ?? randomUUID()),
      rewardId = String(reward?.id ?? randomUUID())
    if (
      code &&
      ((await ours(tx, 'loyalty.Rule', { normalizedCode: code })).some((row) => row.id !== ruleId) ||
        (await ours(tx, 'loyalty.Wallet', { normalizedCode: code })).length)
    )
      refuse('code', 'duplicate')
    const selected = new Map<string, string[]>()
    for (const [field, , , , model] of links) {
      const input = values[field] ?? []
      if (
        !Array.isArray(input) ||
        input.length > 100 ||
        input.some((item) => typeof item !== 'string' || !item)
      )
        refuse(field, 'invalid')
      const ids = [...new Set(input as string[])]
      for (const ref of ids) await reference(tx, model, ref, field)
      selected.set(field, ids)
    }
    const minimumQuantity = decimal(values.minimumQuantity, 'minimumQuantity', '0')
    if (kind === 'buy_x_get_y' && compareDecimals(minimumQuantity, '0') <= 0)
      refuse('minimumQuantity', 'invalid')
    const minimumAmount = decimal(values.minimumAmount, 'minimumAmount', '0')
    const taxMode = String(values.taxMode ?? 'excl')
    if (!['incl', 'excl'].includes(taxMode)) refuse('taxMode', 'invalid')
    const pointMode = kind === 'loyalty' ? String(values.pointMode ?? 'money') : 'order'
    if (!['order', 'money', 'unit'].includes(pointMode)) refuse('pointMode', 'invalid')
    const pointAmount = kind === 'loyalty' ? decimal(values.pointAmount, 'pointAmount', '1', true) : '1'
    const salePointStep =
      kind === 'loyalty' && pointMode === 'money'
        ? decimal(values.pointStep, 'pointStep', '1000', true)
        : null
    const rewardType = kind === 'buy_x_get_y' ? 'product' : String(values.rewardType ?? 'discount')
    if (!['discount', 'product'].includes(rewardType)) refuse('rewardType', 'invalid')
    const discountMode = String(values.discountMode ?? 'percent')
    const discountApplicability = String(values.discountApplicability ?? 'order')
    if (!['percent', 'per_order'].includes(discountMode)) refuse('discountMode', 'invalid')
    if (!['order', 'cheapest', 'specific'].includes(discountApplicability))
      refuse('discountApplicability', 'invalid')
    const discount = decimal(values.discount, 'discount', '10', true)
    if (rewardType === 'discount' && discountMode === 'percent' && compareDecimals(discount, '100') > 0)
      refuse('discount', 'invalid')
    if (
      rewardType === 'discount' &&
      discountApplicability === 'specific' &&
      !selected.get('rewardProductIds')!.length
    )
      refuse('rewardProductIds', 'reference')
    const discountMaximum =
      discountMode !== 'percent' || values.discountMaximum == null || values.discountMaximum === ''
        ? null
        : decimal(values.discountMaximum, 'discountMaximum', '0', true)
    const rewardProductId = rewardType === 'product' ? String(values.rewardProductId ?? '') : null
    if (rewardProductId) await reference(tx, 'product.Product', rewardProductId, 'rewardProductId')
    if (rewardType === 'product' && !rewardProductId) refuse('rewardProductId', 'reference')
    const rewardProductQuantity = decimal(values.rewardProductQuantity, 'rewardProductQuantity', '1', true)
    const requiredPoints =
      kind === 'loyalty' ? decimal(values.requiredPoints, 'requiredPoints', '1', true) : '1'
    const company = (await tx.db.select('company.Company', { id: tx.scope.company }))[0]
    if (!company) refuse('company', 'missing')
    const currency = existing?.currency ?? company.currency
    for (const pricelistId of selected.get('pricelistIds')!) {
      const pricelist = (await ours(tx, 'pricing.Pricelist', { id: pricelistId }))[0]
      if (pricelist?.currency !== currency) refuse('pricelistIds', 'reference')
    }
    const stamp = new Date().toISOString()
    const program = {
      name,
      programType: kind,
      active: existing?.active ?? true,
      designVersion: 1,
      salePolicyVersion: 1,
      configVersion: Number(existing?.configVersion ?? 0) + 1,
      phase: 'active',
      sequence: Number(existing?.sequence ?? 10),
      currency,
      startDate,
      endDate,
      dateFrom: null,
      dateTo: null,
      limitUsage: maxUsage !== null,
      maxUsage,
      appliesOn: kind === 'loyalty' ? 'both' : kind === 'next_order_coupons' ? 'future' : 'current',
      trigger: ['promo_code', 'coupons'].includes(kind) ? 'with_code' : 'auto',
      portalVisible: false,
      pointName: 'Points',
      availableSale: true,
      availablePos: false,
      updatedAt: stamp,
    }
    if (existing) await tx.db.update('loyalty.Program', { id }, program)
    else
      await tx.db.insert('loyalty.Program', {
        id,
        ...program,
        usageCount: 0,
        voucherValidityDays: null,
        createdAt: stamp,
      })
    const ruleValues = {
      programId: id,
      active: true,
      priority: 10,
      productId: null,
      categoryId: null,
      tagId: null,
      pointAmount,
      pointMode,
      pointSplit: false,
      salePointStep,
      minimumQuantity,
      minimumAmount,
      taxMode,
      mode: kind === 'promo_code' ? 'with_code' : 'auto',
      code,
      normalizedCode: code,
    }
    const rewardValues = {
      programId: id,
      active: true,
      description: name,
      rewardType,
      discount,
      discountMode,
      discountApplicability,
      discountMaximum,
      discountProductId: null,
      discountCategoryId: null,
      discountTagId: null,
      rewardProductId,
      lineProductId: null,
      rewardProductQuantity,
      requiredPoints,
      clearWallet: false,
    }
    if (rule) await tx.db.update('loyalty.Rule', { id: ruleId }, ruleValues)
    else await tx.db.insert('loyalty.Rule', { id: ruleId, ...ruleValues })
    if (reward) await tx.db.update('loyalty.Reward', { id: rewardId }, rewardValues)
    else await tx.db.insert('loyalty.Reward', { id: rewardId, ...rewardValues })
    for (const [field, model, parent, target] of links) {
      const parentId = parent === 'programId' ? id : parent === 'ruleId' ? ruleId : rewardId
      const table = tx.table(model)
      await tx.db.del(deleteFrom(table).where(eq(table[parent], parentId)))
      for (const ref of selected.get(field)!)
        await tx.db.insert(model, { id: randomUUID(), [parent]: parentId, [target]: ref })
    }
    return { ok: true, id, revision: program.configVersion }
  })
}
export async function setProgramActive(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const row = await claim(tx, String(args.id), args.expectedRevision)
    await tx.db.update(
      'loyalty.Program',
      { id: row.id },
      { active: args.active, updatedAt: new Date().toISOString() },
    )
    return { ok: true, id: row.id, revision: Number(row.configVersion) + 1 }
  })
}
export async function getProgram(ctx: Ctx, args: Row) {
  const program = (await ours(ctx, 'loyalty.Program', { id: args.id }))[0]
  if (program?.salePolicyVersion !== 1) return null
  const rule = (await ours(ctx, 'loyalty.Rule', { programId: program.id }))[0]
  const reward = (await ours(ctx, 'loyalty.Reward', { programId: program.id }))[0]
  const values: Row = {
    ...program,
    ...rule,
    ...reward,
    id: program.id,
    name: program.name,
    active: program.active,
    revision: program.configVersion,
    pointStep: rule?.salePointStep,
  }
  for (const [field, model, parent, target] of links) {
    const parentId = parent === 'programId' ? program.id : parent === 'ruleId' ? rule?.id : reward?.id
    values[field] = parentId ? (await ours(ctx, model, { [parent]: parentId })).map((row) => row[target]) : []
  }
  values.cards = (await ours(ctx, 'loyalty.Wallet', { programId: program.id })).length
  values.uses = (
    await ours(ctx, 'loyalty.Application', { programId: program.id, state: 'finalized' })
  ).filter((row) => row.rewardId).length
  return values
}
/** What the program list shows of one program: its code, its reward and how often it was used. */
async function listRow(ctx: Ctx, row: Row) {
  const rule = (await ours(ctx, 'loyalty.Rule', { programId: row.id }))[0]
  const reward = (await ours(ctx, 'loyalty.Reward', { programId: row.id }))[0]
  const product = reward?.rewardProductId
    ? (await ctx.db.select('product.Product', { id: reward.rewardProductId }))[0]
    : undefined
  const template = product
    ? (await ctx.db.select('product.Template', { id: product.templateId }))[0]
    : undefined
  return {
    id: row.id,
    name: row.name,
    programType: row.programType,
    active: row.active,
    startDate: row.startDate,
    endDate: row.endDate,
    revision: row.configVersion,
    code: rule?.code ?? null,
    ...rewardTerms(row, rule, reward, template ? String(template.name) : null),
    uses: (await ours(ctx, 'loyalty.Application', { programId: row.id, state: 'finalized' })).filter(
      (application) => application.rewardId,
    ).length,
    cards: (await ours(ctx, 'loyalty.Wallet', { programId: row.id })).length,
  }
}
export async function listPrograms(ctx: Ctx, args: Row) {
  const query = {
    search: String(args.search ?? '').trim(),
    active: args.active,
    programType: args.programType,
  }
  const all = (await ours(ctx, 'loyalty.Program', { salePolicyVersion: 1 })).sort(
    (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)),
  )
  const rows = all.filter(
    (row) =>
      (args.active == null || row.active === args.active) &&
      (!args.programType || row.programType === args.programType) &&
      nameKey(row.name).includes(nameKey(query.search)),
  )
  const pageSize = Math.max(1, Math.min(100, Number(args.pageSize ?? 25)))
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)),
    page = Math.max(1, Math.min(pages, Number(args.page ?? 1)))
  return {
    query,
    total: rows.length,
    page,
    pages,
    isEmpty: all.length === 0,
    // The page's rows only: each reads its own rule, reward, uses and cards.
    rows: await Promise.all(
      rows.slice((page - 1) * pageSize, page * pageSize).map((row) => listRow(ctx, row)),
    ),
    counts: { all: all.length, active: all.filter((row) => row.active).length },
  }
}

/** One batch and its initial ledger entries either all persist or all roll back. */
export async function generateCoupons(ctx: Ctx, args: Row) {
  return loyaltyTransaction(ctx, async (tx) => {
    await claimSaleProgramNamespace(tx)
    const program = await claim(tx, String(args.id), args.expectedRevision)
    if (!program.active || program.programType !== 'coupons') refuse('id', 'invalid')
    const count = Number(args.count)
    if (!Number.isInteger(count) || count < 1 || count > 100) refuse('count', 'invalid')
    if (args.partnerId) await reference(tx, 'partner.Partner', args.partnerId, 'partnerId')
    const expires = date(args.expiresOn, 'expiresOn')
    const codes: string[] = []
    for (let index = 0; index < count; index++) {
      const id = randomUUID()
      const wallet = await ensureLoyaltyWallet(tx, program, {
        id,
        partnerId: args.partnerId ? String(args.partnerId) : null,
        expiresAt: null,
      })
      if (expires) await tx.db.update('loyalty.Wallet', { id }, { saleExpiresOn: expires })
      await postDelta(tx, {
        id: id + ':issue',
        walletId: id,
        operation: 'issue',
        amount: 1,
        balanceDelta: 1,
        sourceType: 'sale_coupon_batch',
        sourceId: String(program.id),
        sourceOperation: 'issue',
        sourceKey: id + ':issue',
        descriptionCode: 'loyalty.ledger.description.issue',
      })
      codes.push(String(wallet.code))
    }
    return { ok: true, id: program.id, revision: Number(program.configVersion) + 1, codes }
  })
}
