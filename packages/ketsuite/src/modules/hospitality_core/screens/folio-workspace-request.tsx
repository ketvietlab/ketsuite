import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { shell } from '../../../ui/index.ts'
import { messages } from '../messages.ts'
import { messages as billingMessages } from '../../hospitality_billing/messages.ts'
import { HOSPITALITY_RECORD_LABELS } from '../records/config.ts'
import type { FolioPageData } from '../records/folio-page.tsx'
import { hospitalityAdminPage } from './hospitality-admin-page.tsx'
import { hospitalityRecordBack, hospitalityScopedHref } from './scoped-href.ts'

export const folioWorkspaceRequest =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('hospitality_core.getFolioWorkspace', url, req)))
      return text('Forbidden', { status: 403 })
    const { record } = (await ctx.call(
      'hospitality_core.getFolioWorkspace',
      {
        id: params.id,
        chargePage: Number(url.searchParams.get('chargePage')) || 1,
        stayPage: Number(url.searchParams.get('stayPage')) || 1,
        chargeId: url.searchParams.get('chargeId') || undefined,
      },
      url,
      req,
    )) as { record: Record<string, unknown> | null }
    if (!record) return text('Not found', { status: 404 })
    const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      _ = ctx.translate(locale)
    const can: Record<string, boolean> = {}
    for (const [action, fn] of Object.entries({
      charge: 'hospitality_core.postFolioServiceCharge',
      void: 'hospitality_core.voidCharge',
      adjust: 'hospitality_core.adjustCharge',
      invoice: 'hospitality_billing.invoiceFolio',
      payment: 'hospitality_billing.recordFolioPayment',
      finance: 'hospitality_billing.getFolioFinanceWorkspace',
    }))
      can[action] = await ctx.allows(fn, url, req)
    const finance = can.finance
      ? (
          (await ctx.call(
            'hospitality_billing.getFolioFinanceWorkspace',
            { folioId: record.id, page: Number(url.searchParams.get('paymentPage')) || 1 },
            url,
            req,
          )) as { record: Record<string, unknown> | null }
        ).record
      : null
    const translated: Record<string, string> = { ...HOSPITALITY_RECORD_LABELS[locale] }
    for (const key of Object.keys(messages[locale]).filter((key) =>
      /^(policy\.|collection\.lookup\.|folioPage\.|folio\.|folioState\.|charge\.|chargeState\.|validation\.)/.test(
        key,
      ),
    ))
      translated[`hospitality_core.${key}`] = _(`hospitality_core.${key}`)
    for (const key of Object.keys(billingMessages[locale]).filter((key) =>
      /^(workspace\.|blocker\.|validation\.)/.test(key),
    ))
      translated[`hospitality_billing.${key}`] = _(`hospitality_billing.${key}`)
    const page = new URL(url)
    page.pathname = `/admin/hospitality/folios/${encodeURIComponent(String(record.id))}`
    for (const key of ['status', 'dialog', 'action', 'finance']) page.searchParams.delete(key)
    const fallback = hospitalityScopedHref(
      url,
      `/admin/hospitality/folios?property=${encodeURIComponent(String(record.propertyId))}`,
    )
    const envelope: { data: FolioPageData; messages: Record<string, string> } = {
      data: {
        record,
        finance,
        can,
        locale,
        commandKey: randomUUID(),
        backHref: hospitalityRecordBack(url.pathname + url.search, fallback),
        refreshHref: page.pathname + page.search,
        scope: new URLSearchParams(
          [...url.searchParams].filter(([key]) =>
            ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
          ),
        ).toString(),
      },
      messages: translated,
    }
    if (url.pathname.endsWith('/workspace-context')) return json(envelope)
    const title = _('hospitality_core.folio.detail.title', { code: String(record.code) })
    const island = await ctx.joint(url, req, 'hospitality_core:folio.page', {
      id: String(record.id),
      title,
      loading: translated['recordModal.loading'],
      back: envelope.data.backHref,
      width: 'wide',
      dialog: url.searchParams.get('dialog') ?? url.searchParams.get('finance') ?? '',
      envelope,
    })
    return hospitalityAdminPage(ctx, url, req, {
      title,
      translate: false,
      body: (_, frame) => shell(_, title, <>{island}</>, { ...frame, topbar: false, titled: false }),
    })
  }
