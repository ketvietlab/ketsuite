import { billingRuleCollectionRequest } from './collection-request.tsx'
import { rowListSearch } from '../../backend/row-list.ts'
import { chargeRuleListSearch, folioBillingListSearch } from '../search.ts'
import { createHash } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { hospitalityAdminPage as adminPage } from '../../hospitality_core/screens/hospitality-admin-page.tsx'
import { readForm, seeOther } from '../../backend/forms.ts'
import { billingScreen, chargeRulesScreen } from './index.ts'
import type { ChargeRuleRow, ChoiceRow, FolioBillingRow } from './index.ts'
import {
  billingSearchFunctions,
  ruleModalHref,
  ruleListHref,
  ruleResultRedirect,
} from './billing-request-shared.ts'
import type { Called, Row } from './billing-request-shared.ts'
export const billingRequestBillingRulesRequest: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method === 'GET') {
      const record =
        url.searchParams.get('rule') ||
        url.searchParams.get('edit') ||
        (url.searchParams.has('create') ? 'new' : null)
      if (record && !url.searchParams.has('record'))
        url.searchParams.set('record', `hospitality.billingRule:${record}`)
      for (const key of ['rule', 'edit', 'create']) url.searchParams.delete(key)
      return billingRuleCollectionRequest(ctx)(url, req, {})
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      if (form.operation !== 'save-rule') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        'hospitality_billing.saveChargeRule',
        {
          chargeType: form.chargeType ?? '',
          taxId: form.taxId || undefined,
          taxExempt: !form.taxId,
          taxExemptReason: form.taxExemptReason || undefined,
          expectedVersion: form.expectedVersion ? Number(form.expectedVersion) : undefined,
          requestKey: form.requestKey || undefined,
          incomeAccountId: form.incomeAccountId || undefined,
          taxAccountId: form.taxAccountId || undefined,
        },
        url,
        req,
      )) as Called
      return ruleResultRedirect(url, Boolean(result.ok), {
        chargeType: form.chargeType,
        taxId: form.taxId,
        incomeAccountId: form.incomeAccountId,
        taxAccountId: form.taxAccountId,
      })
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })

    const [rules, taxes, accounts] = (await Promise.all([
      ctx.call('hospitality_billing.listChargeRules', {}, url, req),
      ctx.call('account.listTaxes', {}, url, req),
      ctx.call('account.listAccounts', {}, url, req),
    ])) as [ChargeRuleRow[], Row[], Row[]]

    const choices = (rows: Row[]): ChoiceRow[] =>
      rows.map((row) => ({ id: String(row.id), name: `${String(row.code)} · ${String(row.name)}` }))

    return adminPage(ctx, url, req, {
      title: 'hospitality_billing.chargeRules.title',
      body: async (_, frame) => {
        const selected = rules.find((row) => row.chargeType === url.searchParams.get('rule'))
        const search = await rowListSearch(ctx, url, req, {
          spec: chargeRuleListSearch,
          rows: rules,
          frame,
          name: 'hospitality-charge-rule-filter',
          bodyId: 'hospitality-charge-rule-list',
          functions: billingSearchFunctions,
          labels: { searchPlaceholder: _('hospitality_billing.chargeRules.title') },
          groupLabel: (key, value) =>
            key === 'configured'
              ? _(
                  value === true || value === 'true'
                    ? 'hospitality_billing.chargeRules.configured'
                    : 'hospitality_billing.chargeRules.missing',
                )
              : String(value ?? ''),
        })
        return chargeRulesScreen(
          _,
          search.rows,
          taxes
            .filter((row) => ['sale', 'none'].includes(String(row.typeTaxUse)))
            .map((row) => ({ id: String(row.id), name: String(row.name) })),
          choices(accounts.filter((row) => String(row.accountType).startsWith('income'))),
          choices(accounts.filter((row) => String(row.accountType).startsWith('liability'))),
          search.frame,
          url.searchParams.get('status'),
          {
            open: url.searchParams.get('create') === '1',
            createHref: ruleModalHref(url),
            closeHref: ruleListHref(url),
            action: ruleModalHref(url, selected?.chargeType),
            selected,
            rowHref: (row) => ruleModalHref(url, row.chargeType),
            errors:
              url.searchParams.get('status') === 'invalid'
                ? [_('hospitality_billing.feedback.invalid')]
                : undefined,
            values: Object.fromEntries(
              ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId'].flatMap((key) =>
                url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [],
              ),
            ),
          },
          search.groups ? { groups: search.groups } : undefined,
        )
      },
    })
  }
