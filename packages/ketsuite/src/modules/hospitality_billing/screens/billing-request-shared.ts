import { billingRuleCollectionRequest } from './collection-request.tsx'
import { rowListSearch } from '../../backend/row-list.ts'
import { chargeRuleListSearch, folioBillingListSearch } from '../search.ts'
import { createHash } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { readForm, seeOther } from '../../backend/forms.ts'
import { billingScreen, chargeRulesScreen } from './index.ts'
import type { ChargeRuleRow, ChoiceRow, FolioBillingRow } from './index.ts'
export type Called = { ok?: boolean }

export type Row = Record<string, unknown>

export const billingSearchFunctions = {
  apply: 'hospitality_billing.applySearchFilter',
  saveFavorite: 'hospitality_billing.saveSearchFavorite',
  deleteFavorite: 'hospitality_billing.deleteSearchFavorite',
  setDefaultFavorite: 'hospitality_billing.setDefaultSearchFavorite',
}

export const redirected = (url: URL, state: 'saved' | 'invoiced' | 'paid' | 'queued' | 'invalid') => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', state)
  return seeOther(`${url.pathname}?${params.toString()}`)
}

export const ruleModalHref = (url: URL, chargeType?: string): string => {
  const params = new URLSearchParams(url.searchParams)
  params.delete('status')
  for (const key of ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId']) params.delete(key)
  params.set('create', '1')
  if (chargeType) params.set('rule', chargeType)
  else params.delete('rule')
  return `${url.pathname}?${params.toString()}`
}

export const ruleListHref = (url: URL): string => {
  const params = new URLSearchParams(url.searchParams)
  params.delete('create')
  params.delete('rule')
  params.delete('status')
  for (const key of ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId']) params.delete(key)
  const query = params.toString()
  return `${url.pathname}${query ? `?${query}` : ''}`
}

export const ruleResultRedirect = (url: URL, ok: boolean, values: Record<string, string | undefined>) => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', ok ? 'saved' : 'invalid')
  if (ok) {
    params.delete('create')
    params.delete('rule')
  } else params.set('create', '1')
  for (const [key, value] of Object.entries(values)) {
    if (!ok && value !== undefined) params.set(key, value)
    else params.delete(key)
  }
  return seeOther(`${url.pathname}?${params.toString()}`)
}

export const paymentId = (folioId: string, requestKey: string): string =>
  `folio-payment:${createHash('sha256').update(`${folioId}:${requestKey}`).digest('hex').slice(0, 24)}`

export const liquidityJournal = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string | null> => {
  const journals = (await ctx.call('account.listJournals', {}, url, req)) as Row[]
  const found = journals.find((row) => ['cash', 'bank'].includes(String(row.type)) && row.defaultAccountId)
  return found ? String(found.id) : null
}
