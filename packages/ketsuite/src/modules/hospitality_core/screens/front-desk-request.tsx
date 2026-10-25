import { RecordForm } from '@ketvietlab/design-system'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import { adminPage, frontDeskScreen, text } from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'
import type { FrontDeskData } from './front-desk.tsx'

export const hospitalityRequestFrontDesk: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const askedDay = url.searchParams.get('date')
    if (
      askedDay &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(askedDay) ||
        !Number.isFinite(Date.parse(`${askedDay}T12:00:00Z`)) ||
        new Date(`${askedDay}T12:00:00Z`).toISOString().slice(0, 10) !== askedDay)
    )
      return text('Invalid date', { status: 400 })
    const lang = ctx.localeOf(url, req)
    const page = (key: string) =>
      Math.max(1, Math.min(1000000, Math.trunc(Number(url.searchParams.get(key)) || 1)))
    const data = (await ctx.call(
      'hospitality_core.getFrontDesk',
      {
        ...(url.searchParams.get('property') ? { propertyId: url.searchParams.get('property') } : {}),
        ...(url.searchParams.get('date') ? { day: url.searchParams.get('date') } : {}),
        arrivalsPage: page('arrivalsPage'),
        departuresPage: page('departuresPage'),
        overduePage: page('overduePage'),
      },
      url,
      req,
    )) as FrontDeskData
    const _ = ctx.translate(lang)
    const hidden = Object.fromEntries(
      ['company', 'companies', 'branch', 'branches', 'lang']
        .filter((key) => url.searchParams.has(key))
        .map((key) => [key, url.searchParams.getAll(key)]),
    )
    const propertyControl = await relationControl(ctx, url, req, 'front-desk-property', {
      name: 'property',
      ariaLabel: _('hospitality_core.menu.properties'),
      required: true,
      value: data.propertyId,
      options: data.propertyId
        ? [{ value: data.propertyId, label: data.propertyName ?? data.propertyId }]
        : [],
      labels: relationLabels(_, _('hospitality_core.menu.properties')),
      disabled: !(await ctx.allows('hospitality_core.lookupProperties', url, req)),
      manager: {
        listFunction: 'hospitality_core.lookupProperties',
        listInput: {},
        searchInDropdown: true,
        requestQuery: new URLSearchParams(
          [...url.searchParams].filter(([key]) =>
            ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
          ),
        ).toString(),
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    })
    const controls = (
      <RecordForm
        id="front-desk-filters"
        action="/admin/hospitality/front-desk"
        method="get"
        hidden={hidden}
        submitLabel={_('hospitality_core.action.apply')}
        submitVariant="secondary"
        fields={[
          {
            id: 'front-desk-property',
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            required: true,
            control: propertyControl,
          },
          {
            id: 'front-desk-date',
            name: 'date',
            label: _('hospitality_core.col.date'),
            type: 'date',
            value: data.day,
            locale: lang === 'en' ? 'en' : 'vi',
            required: true,
          },
        ]}
      />
    )
    const source = new URL(url)
    if (data.propertyId) source.searchParams.set('property', data.propertyId)
    source.searchParams.set('date', data.day)
    const billing = await ctx.allows('hospitality_billing.getFolioBilling', url, req)
    if (data.propertyId && (await ctx.allows('hospitality_billing.getFrontDeskBillingSummary', url, req))) {
      data.billingSummary = (await ctx.call(
        'hospitality_billing.getFrontDeskBillingSummary',
        { propertyId: data.propertyId, day: data.day },
        url,
        req,
      )) as FrontDeskData['billingSummary']
    }
    if (billing) {
      const rows = [...data.departures.rows, ...data.overdue.rows]
      const ids = [...new Set(rows.map((row) => row.folioId))]
      const balances = new Map(
        await Promise.all(
          ids.map(async (folioId) => {
            const value = (await ctx.call('hospitality_billing.getFolioBilling', { folioId }, url, req)) as {
              balance?: string
              balanceKnown?: boolean
            } | null
            return [folioId, value] as const
          }),
        ),
      )
      for (const row of rows) {
        const money = balances.get(row.folioId)
        row.balance = money?.balanceKnown && money.balance !== undefined ? money.balance : null
      }
    }
    const may = {
      housekeeping: await ctx.allows('hospitality_core.getCleaningTaskRecord', url, req),
      billing,
      create: await ctx.allows('hospitality_billing.confirmDeskBooking', url, req),
      walkIn:
        (await ctx.allows('hospitality_core.declareArrivalGuests', url, req)) &&
        ((await ctx.allows('hospitality_billing.takeReservationGuarantee', url, req)) ||
          (await ctx.allows('hospitality_billing.setReservationGuarantee', url, req))),
      checkIn: await ctx.allows('hospitality_core.checkIn', url, req),
      checkOut: await ctx.allows('hospitality_core.checkOut', url, req),
    }
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.frontDesk.title',
      body: (_, frame) =>
        frontDeskScreen(
          _,
          {
            controls,
            day: data.day,
            arrivals: data.arrivals.rows,
            departures: data.departures.rows,
            overdue: data.overdue.rows,
            inHouse: [],
            queues: data,
            source: source.href,
          },
          may,
          lang,
          data.timezone,
          frame,
          data.configured,
        ),
    })
  }
