import { messages as billingMessages } from '../../hospitality_billing/messages.ts'
import type { ReservationPageData } from '../records/reservation-page.tsx'
import { localDateTime } from './request-shared.tsx'
import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { shell } from '../../../ui/index.ts'
import { messages } from '../messages.ts'
import { hospitalityAdminPage } from './hospitality-admin-page.tsx'
import { hospitalityRecordBack } from './scoped-href.ts'

export const reservationWorkspaceRequest =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('hospitality_core.getReservationWorkspace', url, req)))
      return text('Forbidden', { status: 403 })
    const id = params.id!,
      locale = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      _ = ctx.translate(locale)
    const { record } = (await ctx.call(
      'hospitality_core.getReservationWorkspace',
      {
        id,
        assignmentPage: Number(url.searchParams.get('assignmentPage')) || 1,
        historyPage: Number(url.searchParams.get('historyPage')) || 1,
      },
      url,
      req,
    )) as { record: Record<string, unknown> | null }
    if (!record) return text('Not found', { status: 404 })
    const page = new URL(url)
    page.pathname = `/admin/hospitality/reservations/${encodeURIComponent(id)}`
    page.searchParams.delete('status')
    const href = (query: Record<string, string> = {}) => {
      const target = new URL(page)
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
      return target.pathname + target.search
    }
    const can: Record<string, boolean> = {}
    for (const fn of [
      'amendReservation',
      'checkIn',
      'declareArrivalGuests',
      'setReservationArrivalPlan',
      'setReservationGuestBenefits',
      'holdRoom',
      'releaseRoomHold',
      'adjustStayDeparture',
      'moveRoom',
      'addInHouseGuest',
      'cancelReservation',
      'markNoShow',
      'checkOut',
    ])
      can[fn] = await ctx.allows(`hospitality_core.${fn}`, url, req)
    can.finance = await ctx.allows('hospitality_billing.getReservationGuaranteeContext', url, req)
    can.takeDeposit =
      can.finance && (await ctx.allows('hospitality_billing.takeReservationGuarantee', url, req))
    can.setGuarantee =
      can.finance && (await ctx.allows('hospitality_billing.setReservationGuarantee', url, req))
    can.arrive =
      can.checkIn && can.finance && (await ctx.allows('hospitality_billing.arriveReservation', url, req))
    const finance = can.finance
      ? ((await ctx.call(
          'hospitality_billing.getReservationGuaranteeContext',
          { reservationId: id, includeChoices: false },
          url,
          req,
        )) as Record<string, unknown>)
      : null
    const additionalGuest =
      can.addInHouseGuest &&
      record.state === 'checked_in' &&
      (record.stay as Record<string, unknown> | null)?.id
        ? (
            (await ctx.call(
              'hospitality_core.getInHouseGuestPlan',
              { stayId: (record.stay as Record<string, unknown>).id },
              url,
              req,
            )) as { plan: Record<string, unknown> | null }
          ).plan
        : null
    const departure =
      can.checkOut && record.state === 'checked_in' && (record.stay as Record<string, unknown> | null)?.id
        ? ((await ctx.call(
            'hospitality_core.checkOutReadiness',
            {
              stayId: (record.stay as Record<string, unknown>).id,
              page: Number(url.searchParams.get('checkoutPage')) || 1,
            },
            url,
            req,
          )) as Record<string, unknown>)
        : null
    const departureFinance =
      departure?.folioId && (await ctx.allows('hospitality_billing.getFolioFinanceWorkspace', url, req))
        ? (
            (await ctx.call(
              'hospitality_billing.getFolioFinanceWorkspace',
              { folioId: departure.folioId },
              url,
              req,
            )) as { record: Record<string, unknown> | null }
          ).record
        : null
    const translated: Record<string, string> = {}
    for (const key of Object.keys(messages[locale]!).filter((key) =>
      /^(form\.|field\.cancellationPolicy$|policy\.|screen\.frontDesk\.event\.|reservation\.|folio\.charge\.|checkOutPrep\.|stay\.document\.|document\.|gender\.|reservationState\.|assignmentState\.|validation\.|col\.|billing\.|provider\.|bookingType\.)/.test(
        key,
      ),
    ))
      translated[`hospitality_core.${key}`] = _(`hospitality_core.${key}`)
    for (const key of [
      'choose',
      'search',
      'more',
      'noRecords',
      'loading',
      'loadError',
      'close',
      'select',
      'create',
      'edit',
      'save',
      'cancel',
      'remove',
      'confirmRemove',
      'retry',
      'clear',
      'chosen',
    ])
      translated[`backend.relation.${key}`] = _(`backend.relation.${key}`)
    for (const key of Object.keys(billingMessages[locale]!).filter((key) =>
      /^(guarantee\.|validation\.)/.test(key),
    ))
      translated[`hospitality_billing.${key}`] = _(`hospitality_billing.${key}`)
    const words =
      locale === 'en'
        ? {
            unavailable: 'This action is not available for the current state or access.',
            noGuarantee: 'No guarantee recorded',
            pricing: 'Price and source',
            recordUpdated: 'Record updated',
            back: 'Back',
            refresh: 'Refresh',
            assignments: 'Room assignments',
            history: 'History',
            previous: 'Previous',
            next: 'Next',
            empty: 'No entries',
            guarantee: 'Booking guarantee',
            guaranteed: 'Valid guarantee',
            missingGuarantee: 'Guarantee required before check-in',
            finance: 'Manage guarantee',
            stay: 'Stay details',
            close: 'Close',
            loading: 'Loading…',
            loadFailed: 'Could not load the reservation.',
            notFound: 'Reservation not found or access denied.',
            retry: 'Retry',
            errorTitle: 'Not completed',
            saveFailed: 'Please retry.',
            savedTitle: 'Saved',
            saved: 'The operation completed.',
            unsaved: 'Discard changes?',
            confirm: 'Confirm',
            cancel: 'Go back',
          }
        : {
            unavailable: 'Thao tác không khả dụng với trạng thái hoặc quyền hiện tại.',
            noGuarantee: 'Chưa ghi nhận bảo đảm',
            pricing: 'Giá và nguồn đặt',
            recordUpdated: 'Cập nhật hồ sơ',
            back: 'Quay lại',
            refresh: 'Tải lại',
            assignments: 'Lịch phân phòng',
            history: 'Lịch sử',
            previous: 'Trước',
            next: 'Sau',
            empty: 'Chưa có dữ liệu',
            guarantee: 'Bảo đảm đặt phòng',
            guaranteed: 'Bảo đảm hợp lệ',
            missingGuarantee: 'Cần bảo đảm trước khi nhận phòng',
            finance: 'Quản lý bảo đảm',
            stay: 'Chi tiết lượt ở',
            close: 'Đóng',
            loading: 'Đang tải…',
            loadFailed: 'Chưa tải được đặt phòng.',
            notFound: 'Không tìm thấy đặt phòng hoặc không có quyền.',
            retry: 'Thử lại',
            errorTitle: 'Chưa hoàn tất',
            saveFailed: 'Vui lòng thử lại.',
            savedTitle: 'Đã lưu',
            saved: 'Thao tác đã hoàn tất.',
            unsaved: 'Bỏ thay đổi?',
            confirm: 'Xác nhận',
            cancel: 'Quay lại',
          }
    for (const [key, value] of Object.entries(words)) {
      translated[`workspace.${key}`] = value
      translated[`recordModal.${key}`] = value
    }
    const paging = Object.fromEntries(
      ['assignments', 'history'].map((name) => {
        const data = record[name] as { page: number; pages: number }
        const key = name === 'assignments' ? 'assignmentPage' : 'historyPage'
        return [
          name,
          {
            previous: data.page > 1 ? href({ [key]: String(data.page - 1) }) : null,
            next: data.page < data.pages ? href({ [key]: String(data.page + 1) }) : null,
          },
        ]
      }),
    )
    const fallback = new URL('/admin/hospitality/reservations', url)
    for (const key of ['company', 'companies', 'branch', 'branches', 'lang'])
      for (const value of page.searchParams.getAll(key)) fallback.searchParams.append(key, value)
    fallback.searchParams.set('property', String(record.propertyId))
    const envelope: { data: ReservationPageData; messages: Record<string, string> } = {
      data: {
        record,
        finance,
        additionalGuest,
        departure,
        departureFinance: departureFinance
          ? {
              paid: departureFinance.paid,
              balance: departureFinance.balance,
              balanceKnown: departureFinance.balanceKnown,
            }
          : null,
        localDates: {
          moveAt: localDateTime(new Date(), String((record.property as Record<string, unknown>).timezone)),
          checkIn: localDateTime(
            new Date(String(record.checkIn)),
            String((record.property as Record<string, unknown>).timezone),
          ),
          checkOut: localDateTime(
            new Date(String(record.checkOut)),
            String((record.property as Record<string, unknown>).timezone),
          ),
        },
        can,
        locale,
        paging,
        commandKey: randomUUID(),
        scope: new URLSearchParams(
          [...url.searchParams].filter(([key]) =>
            ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
          ),
        ).toString(),
        backHref: hospitalityRecordBack(url.pathname + url.search, fallback.pathname + fallback.search),
        refreshHref: href(),
        checkoutHref: href({ action: 'check-out' }),
      },
      messages: translated,
    }
    if (url.pathname.endsWith('/record-context')) return json(envelope)
    const title = _('hospitality_core.reservation.detail.title', { code: String(record.code) })
    const island = await ctx.joint(url, req, 'hospitality_core:reservation.page', {
      id,
      title,
      loading: words.loading,
      back: envelope.data.backHref,
      width: 'wide',
      dialog: url.searchParams.get('dialog') ?? '',
      envelope,
    })
    return hospitalityAdminPage(ctx, url, req, {
      title,
      translate: false,
      body: (_, frame) => shell(_, title, <>{island}</>, { ...frame, topbar: false, titled: false }),
    })
  }
