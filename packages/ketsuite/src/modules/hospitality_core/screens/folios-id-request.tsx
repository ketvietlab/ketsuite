import { folioWorkspaceRequest } from './folio-workspace-request.tsx'
import { paymentId } from '../../hospitality_billing/screens/billing-request-shared.ts'
import {
  operationErrors,
  randomUUID,
  readForm,
  renderFolioDetail,
  seeOther,
  text,
} from './request-shared.tsx'
import type { OperationResult, Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'

export const hospitalityRequestFoliosId: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'GET') return folioWorkspaceRequest(ctx)(url, req, params)
    if (req.method !== 'POST') return text('GET or POST', { status: 405 })
    const form = await readForm(req)
    let result: OperationResult
    let status: 'charge-posted' | 'charge-voided' | 'invoiced' | 'paid' | 'charge-adjusted'

    if (form.operation === 'adjust-charge') {
      result = (await ctx.call(
        'hospitality_core.adjustCharge',
        {
          folioId: params.id,
          chargeId: form.chargeId ?? '',
          amount: form.amount ?? '0',
          reason: form.reason ?? '',
          expectedVersion: Number(form.expectedVersion),
          requestKey: form.requestKey ?? '',
        },
        url,
        req,
      )) as OperationResult
      status = 'charge-adjusted'
    } else if (form.operation === 'invoice-folio' || form.operation === 'record-payment') {
      if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(form.requestKey ?? '') || !/^\d+$/.test(form.expectedVersion ?? ''))
        return text('Invalid request identity', { status: 400 })
      const expectedVersion = Number(form.expectedVersion),
        requestKey = form.requestKey!
      const input =
        form.operation === 'invoice-folio'
          ? {
              folioId: params.id,
              expectedVersion,
              requestKey,
              buyerType: form.buyerType ?? 'guest',
              buyerName: form.buyerName ?? '',
              buyerTaxCode: form.buyerTaxCode ?? '',
              buyerAddress: form.buyerAddress ?? '',
              buyerEmail: form.buyerEmail ?? '',
            }
          : {
              id: paymentId(params.id, requestKey),
              folioId: params.id,
              expectedVersion,
              requestKey,
              amount: form.amount ?? '0',
              journalId: form.journalId ?? '',
              reference: form.reference ?? '',
              memo: form.memo ?? '',
            }
      result = (await ctx.call(
        form.operation === 'invoice-folio'
          ? 'hospitality_billing.invoiceFolio'
          : 'hospitality_billing.recordFolioPayment',
        input,
        url,
        req,
      )) as OperationResult
      status = form.operation === 'invoice-folio' ? 'invoiced' : 'paid'
    } else if (form.operation === 'post-charge') {
      const id = form.id?.trim() || randomUUID()
      result = (await ctx.call(
        'hospitality_core.addCharge',
        {
          id,
          folioId: params.id,
          stayId: form.stayId?.trim() || undefined,
          description: form.description?.trim() || '',
          type: form.type?.trim() || 'service',
          quantity: form.quantity?.trim() || '1',
          unitPrice: form.unitPrice?.trim() || '',
          sourceKey: `manual-charge:${id}`,
          expectedVersion: Number(form.expectedVersion ?? 0),
          requestKey: form.requestKey ?? id,
        },
        url,
        req,
      )) as OperationResult
      status = 'charge-posted'
    } else if (form.operation === 'void-charge') {
      result = (await ctx.call(
        'hospitality_core.voidCharge',
        {
          id: form.chargeId?.trim() || '',
          folioId: params.id,
          reason: form.reason?.trim() || '',
          expectedVersion: Number(form.expectedVersion ?? 0),
          requestKey: form.requestKey ?? randomUUID(),
        },
        url,
        req,
      )) as OperationResult
      status = 'charge-voided'
    } else return text('unknown action', { status: 400 })

    if (!result.ok)
      return renderFolioDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), {
        ...form,
        _invalid: Array.isArray(result.errors)
          ? result.errors.map((issue) => String((issue as { field?: string }).field ?? '')).join(',')
          : '',
      })
    const query = new URLSearchParams(url.searchParams)
    query.delete('finance')
    query.delete('action')
    query.delete('charge')
    query.set('status', status)
    const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
    if (lang) query.set('lang', lang)
    return seeOther(`${url.pathname}?${query.toString()}`)
  }
