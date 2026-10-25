import type { RouteEntry } from '@ketvietlab/ketjs'
import { adminPage } from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import { roomPlanScreen } from './tape-chart.tsx'
import type { RoomPlanFrame } from './tape-chart.tsx'

/** The room plan's frame; every room and stay is read by its islands in the browser. */
export const hospitalityRequestTapeChart: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const allows = (fn: string) => ctx.allows(fn, url, req)
    // Unguarded: a reader the plan is not for is refused the page, as before.
    const plan = (await ctx.call(
      'hospitality_core.getRoomPlanFrame',
      { ...(url.searchParams.get('property') ? { propertyId: url.searchParams.get('property') } : {}) },
      url,
      req,
    )) as RoomPlanFrame
    const finance = await allows('hospitality_billing.getReservationGuaranteeContext')
    // The same gates as the front desk's header: booking ahead, and a walk-in that also takes the
    // guests' declarations, a guarantee and the arrival in one step.
    const book = await allows('hospitality_billing.confirmDeskBooking')
    const checkIn = await allows('hospitality_core.checkIn')
    const may = {
      book,
      walkIn:
        book &&
        checkIn &&
        (await allows('hospitality_core.declareArrivalGuests')) &&
        ((await allows('hospitality_billing.takeReservationGuarantee')) ||
          (await allows('hospitality_billing.setReservationGuarantee'))),
      checkIn,
      checkout: await allows('hospitality_core.checkOut'),
      move: await allows('hospitality_core.moveRoom'),
      amend: await allows('hospitality_core.amendReservation'),
      deposit: finance && (await allows('hospitality_billing.takeReservationGuarantee')),
      guarantee: finance && (await allows('hospitality_billing.setReservationGuarantee')),
      payment: await allows('hospitality_billing.recordFolioPayment'),
      folio: await allows('hospitality_core.getFolioWorkspace'),
      room: await allows('hospitality_core.getRoomBoard'),
      balance: await allows('hospitality_billing.getFolioDue'),
    }
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.tapeChart.title',
      body: (_, frame) => roomPlanScreen(_, { url, locale, plan, may }, frame),
    })
  }
