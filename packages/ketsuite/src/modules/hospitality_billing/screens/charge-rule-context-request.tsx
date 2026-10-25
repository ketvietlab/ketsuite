import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { CHARGE_TYPES } from '../../hospitality_core/types.ts'
import { HOSPITALITY_RECORD_LABELS } from '../../hospitality_core/records/config.ts'
import { messages as coreMessages } from '../../hospitality_core/messages.ts'
import { messages } from '../messages.ts'
export const chargeRuleContextRequest: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  const id = decodeURIComponent(url.pathname.split('/').at(-2)!),
    creating = id === 'new'
  const canSave = await ctx.allows('hospitality_billing.saveChargeRule', url, req)
  const canRead = await ctx.allows('hospitality_billing.getChargeRuleRecord', url, req)
  if (creating ? !canSave : !canRead) return text('Forbidden', { status: 403 })
  const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const value = creating
    ? {
        record: { id: 'new', chargeType: '', taxExempt: false, taxExemptReason: '', version: 0, history: [] },
      }
    : ((await ctx.call('hospitality_billing.getChargeRuleRecord', { id }, url, req)) as {
        record: Record<string, unknown> | null
      })
  if (!value.record) return text('Not found', { status: 404 })
  const choices: Record<string, Array<Record<string, unknown>>> = {}
  for (const [field, fn, kind] of [
    ['incomeAccountId', 'lookupChargeRuleAccounts', 'income'],
    ['taxAccountId', 'lookupChargeRuleAccounts', 'tax'],
    ['taxId', 'lookupChargeRuleTaxes', null],
  ] as const) {
    if (!(await ctx.allows(`hospitality_billing.${fn}`, url, req))) {
      choices[field] = []
      continue
    }
    const input = { limit: 20, ...(kind ? { kind } : {}) }
    const found = (await ctx.call(`hospitality_billing.${fn}`, input, url, req)) as Array<
      Record<string, unknown>
    >
    const selected = value.record[field]
    if (selected && !found.some((row) => row.id === selected))
      found.push(
        ...((await ctx.call(
          `hospitality_billing.${fn}`,
          { ...input, id: selected, limit: 1 },
          url,
          req,
        )) as Array<Record<string, unknown>>),
      )
    choices[field] = found
  }
  return json({
    data: {
      record: value.record,
      canSave,
      choices,
      chargeTypes: CHARGE_TYPES,
      commandKey: randomUUID(),
      locale,
    },
    messages: {
      ...Object.fromEntries(
        Object.entries(coreMessages[locale])
          .filter(([key]) => key.startsWith('validation.') || key.startsWith('collection.lookup.'))
          .map(([key, value]) => [`hospitality_core.${key}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(messages[locale]).map(([key, value]) => [`hospitality_billing.${key}`, value]),
      ),
      ...HOSPITALITY_RECORD_LABELS[locale],
    },
  })
}
