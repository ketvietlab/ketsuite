import type { JSXChild } from '@ketvietlab/ketjs-view'
import { randomUUID } from 'node:crypto'
import { hospitalityRecordBack } from './scoped-href.ts'
import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  type Choice,
  choices,
  dateTime,
  DefinitionList,
  emptyState,
  formatMoney,
  type Frame,
  guestName,
  icon,
  linkButton,
  providerName,
  RecordForm,
  RecordWorkspace,
  type ReservationAmendmentValues,
  type ReservationDetail,
  reservationDetailFeedback,
  type RoomRow,
  Section,
  stack,
  type TemplateResult,
  type Translator,
  workflowTone,
} from './shared.tsx'

export const reservationDetailScreen = (
  _: Translator,
  reservation: ReservationDetail,
  rooms: RoomRow[],
  roomTypes: Choice[],
  partners: Choice[],
  amendment: ReservationAmendmentValues,
  departure: string,
  locale: string,
  timezone: string,
  frame: Frame,
  status?: string | null,
  errors: readonly string[] = [],
  permissions: {
    amend: boolean
    checkIn: boolean
    holdRoom: boolean
    adjustDeparture: boolean
    checkOut: boolean
    cancel: boolean
    noShow: boolean
  } = {
    amend: true,
    checkIn: true,
    holdRoom: true,
    adjustDeparture: true,
    checkOut: true,
    cancel: true,
    noShow: true,
  },
  guarantee?: TemplateResult | null,
  currentHref?: string,
  pickers: { hold?: JSXChild; checkIn?: JSXChild } = {},
): TemplateResult => {
  const guest = guestName(reservation)
  const room = reservation.stay?.currentRoom
  const backHref = hospitalityRecordBack(
    currentHref,
    `/admin/hospitality/reservations?property=${encodeURIComponent(reservation.propertyId)}&lang=${encodeURIComponent(locale)}`,
  )
  const action =
    currentHref ??
    `/admin/hospitality/reservations/${encodeURIComponent(reservation.id)}?lang=${encodeURIComponent(locale)}`
  const nativeUrl = new URL(action, 'http://hospitality.local')
  nativeUrl.searchParams.delete('action')
  nativeUrl.searchParams.delete('finance')
  nativeUrl.searchParams.set('dialog', 'checkIn')
  const nativeHref = nativeUrl.pathname + nativeUrl.search
  const checkoutUrl = new URL(nativeUrl)
  checkoutUrl.searchParams.delete('dialog')
  checkoutUrl.searchParams.set('action', 'check-out')
  const actions: TemplateResult[] = []
  if (guarantee) actions.push(guarantee)

  if (reservation.state === 'confirmed' && reservation.provider === 'direct' && permissions.amend) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.amend')}
        description={_('hospitality_core.reservation.action.amendHint')}
        body={
          <RecordForm
            action={action}
            method="post"
            submit={_('hospitality_core.reservation.action.amend')}
            submitVariant="secondary"
            hidden={{
              operation: 'amend',
              lang: locale,
              expectedVersion: String(reservation?.version ?? 0),
              requestKey: randomUUID(),
            }}
            fields={[
              {
                name: 'partnerId',
                label: _('hospitality_core.reservation.field.guest'),
                type: 'select',
                value: amendment.partnerId,
                options: choices(partners),
                required: true,
              },
              {
                name: 'roomTypeId',
                label: _('hospitality_core.reservation.field.roomType'),
                type: 'select',
                value: amendment.roomTypeId,
                options: choices(roomTypes),
                required: true,
              },
              {
                name: 'checkIn',
                label: _('hospitality_core.col.checkIn'),
                type: 'datetime-local',
                value: amendment.checkIn,
                required: true,
              },
              {
                name: 'checkOut',
                label: _('hospitality_core.col.checkOut'),
                type: 'datetime-local',
                value: amendment.checkOut,
                required: true,
              },
              {
                name: 'adults',
                label: _('hospitality_core.reservation.field.adults'),
                type: 'number',
                value: amendment.adults,
                step: '1',
                required: true,
              },
              {
                name: 'children',
                label: _('hospitality_core.reservation.field.children'),
                type: 'number',
                value: amendment.children,
                step: '1',
                required: true,
              },
              {
                name: 'rate',
                label: _('hospitality_core.reservation.field.rate'),
                type: 'decimal',
                value: amendment.rate,
                required: true,
              },
            ]}
          />
        }
      />,
    )
  }

  // Choosing the room before the guest arrives is the desk's own decision, made
  // once and kept. Offered while the stay is still ahead of them; after check-in
  // the room is theirs and changing it is `moveRoom`.
  if (reservation.state === 'confirmed' && reservation.stayId && permissions.holdRoom) {
    const held = reservation.stay?.assignments?.find((assignment) => assignment.state === 'held')
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.holdRoom')}
        description={
          held
            ? _('hospitality_core.reservation.action.holdRoomKept', {
                room: held.roomName ?? held.roomId,
              })
            : _('hospitality_core.reservation.action.holdRoomHint')
        }
        body={
          pickers.hold || rooms.length ? (
            <>
              <RecordForm
                action={action}
                method="post"
                submit={_(
                  held
                    ? 'hospitality_core.reservation.action.holdRoomChange'
                    : 'hospitality_core.reservation.action.holdRoom',
                )}
                submitVariant="secondary"
                hidden={{
                  operation: 'hold-room',
                  lang: locale,
                  expectedVersion: String(reservation.stay?.version ?? 0),
                  requestKey: randomUUID(),
                }}
                fields={[
                  {
                    control: pickers.hold,
                    name: 'roomId',
                    label: _('hospitality_core.reservation.field.room'),
                    type: 'select',
                    required: true,
                    value: held?.roomId ?? '',
                    options: rooms.map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.code} · ${candidate.name}`,
                    })),
                  },
                ]}
              />
              {held ? (
                <RecordForm
                  action={action}
                  method="post"
                  submit={_('hospitality_core.reservation.action.releaseRoomHold')}
                  submitVariant="tertiary"
                  hidden={{
                    operation: 'release-room-hold',
                    lang: locale,
                    expectedVersion: String(reservation.stay?.version ?? 0),
                    requestKey: randomUUID(),
                  }}
                  fields={[]}
                />
              ) : null}
            </>
          ) : (
            emptyState(
              _('hospitality_core.reservation.empty.availableRooms'),
              _('hospitality_core.reservation.empty.availableRoomsHint'),
            )
          )
        }
      />,
    )
  }

  if (reservation.state === 'confirmed' && reservation.stayId && permissions.checkIn) {
    actions.push(
      <Section
        title={_('hospitality_core.reservation.action.checkIn')}
        description={_('hospitality_core.reservation.action.checkInHint')}
        body={linkButton({
          href: nativeHref,
          label: _('hospitality_core.reservation.openArrival'),
          variant: 'primary',
        })}
      />,
    )
  }

  if (reservation.state === 'checked_in' && reservation.stayId) {
    if (permissions.adjustDeparture)
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.adjustDeparture')}
          description={_('hospitality_core.reservation.action.adjustDepartureHint')}
          body={
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.adjustDeparture')}
              submitVariant="secondary"
              hidden={{
                operation: 'adjust-departure',
                lang: locale,
                expectedVersion: String(reservation.stay?.version ?? 0),
                requestKey: randomUUID(),
              }}
              fields={[
                {
                  name: 'checkOut',
                  label: _('hospitality_core.col.checkOut'),
                  type: 'datetime-local',
                  value: departure,
                  required: true,
                },
              ]}
            />
          }
        />,
      )
    // Check-out used to be a bare button here: press it and find out. It now
    // leads to the one read that answers whether the guest can go and what is
    // still on the bill, and the button lives there.
    if (permissions.checkOut)
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.checkOut')}
          description={_('hospitality_core.reservation.action.checkOutHint')}
          body={linkButton({
            href: checkoutUrl.pathname + checkoutUrl.search,
            label: _('hospitality_core.checkOutPrep.open'),
            variant: 'primary',
          })}
        />,
      )
  }

  if (
    (reservation.state === 'draft' || reservation.state === 'confirmed') &&
    (permissions.cancel || permissions.noShow)
  ) {
    if (reservation.state === 'confirmed' && permissions.noShow)
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.noShow')}
          description={_('hospitality_core.reservation.action.noShowHint')}
          body={
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.noShow')}
              submitVariant="destructive"
              hidden={{
                operation: 'no-show',
                lang: locale,
                expectedVersion: String(reservation?.version ?? 0),
                requestKey: randomUUID(),
              }}
              fields={[
                {
                  name: 'reason',
                  label: _('hospitality_core.reservation.field.noShowReason'),
                  type: 'textarea',
                  help: _('hospitality_core.reservation.field.noShowReasonHint'),
                  required: true,
                },
              ]}
            />
          }
        />,
      )
    if (permissions.cancel)
      actions.push(
        <Section
          title={_('hospitality_core.reservation.action.cancel')}
          description={_('hospitality_core.reservation.action.cancelHint')}
          body={
            <RecordForm
              action={action}
              method="post"
              submit={_('hospitality_core.reservation.action.cancel')}
              submitVariant="destructive"
              hidden={{
                operation: 'cancel',
                lang: locale,
                expectedVersion: String(reservation?.version ?? 0),
                requestKey: randomUUID(),
              }}
              fields={[
                {
                  name: 'reason',
                  label: _('hospitality_core.reservation.field.cancelReason'),
                  type: 'textarea',
                  help: _('hospitality_core.reservation.field.cancelReasonHint'),
                },
              ]}
            />
          }
        />,
      )
  }

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.reservation.detail.title', { code: reservation.code })}
      frame={frame}
      body={stack([
        reservationDetailFeedback(_, status, errors),
        <RecordWorkspace
          kicker={_('hospitality_core.reservation.detail.kicker')}
          title={reservation.code}
          subtitle={guest}
          imageFallback={icon('hotel')}
          badges={[
            badge(
              _(`hospitality_core.reservationState.${reservation.state}`),
              workflowTone(reservation.state),
              reservation.state,
            ),
            badge(providerName(_, reservation.provider), 'neutral'),
          ]}
          summary={[
            {
              id: 'room-type',
              label: _('hospitality_core.col.roomType'),
              value: reservation.roomType?.name ?? reservation.roomTypeId,
            },
            {
              id: 'guests',
              label: _('hospitality_core.col.guests'),
              value: reservation.adults + reservation.children,
            },
            {
              id: 'total',
              label: _('hospitality_core.col.amount'),
              value: formatMoney(_, reservation.amountTotal),
            },
          ]}
          navigation={linkButton({
            label: _(
              backHref.split('?')[0] === '/admin/hospitality/reservations'
                ? 'hospitality_core.reservation.action.back'
                : 'hospitality_core.reservation.action.backSource',
            ),
            href: backHref,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            <Section
              title={_('hospitality_core.reservation.detail.stay')}
              description={_('hospitality_core.reservation.detail.stayHint')}
              body={
                <DefinitionList
                  title={reservation.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.reservation.field.guest'),
                      value: guest,
                    },
                    {
                      key: 'room',
                      term: _('hospitality_core.reservation.field.room'),
                      value: room?.name ?? room?.code ?? _('hospitality_core.reservation.value.unassigned'),
                    },
                    {
                      key: 'check-in',
                      term: _('hospitality_core.col.checkIn'),
                      value: dateTime(reservation.checkIn, locale, timezone),
                    },
                    {
                      key: 'check-out',
                      term: _('hospitality_core.col.checkOut'),
                      value: dateTime(reservation.checkOut, locale, timezone),
                    },
                    {
                      key: 'booking-type',
                      term: _('hospitality_core.reservation.field.bookingType'),
                      value: _(`hospitality_core.bookingType.${reservation.bookingType}`),
                    },
                    {
                      key: 'billing',
                      term: _('hospitality_core.reservation.field.billingMode'),
                      value: _(`hospitality_core.billing.${reservation.billingMode}`),
                    },
                    {
                      key: 'rate',
                      term: _('hospitality_core.reservation.field.rate'),
                      value: formatMoney(_, reservation.rate),
                    },
                    {
                      key: 'quantity',
                      term: _('hospitality_core.reservation.quote.quantity'),
                      value: String(reservation.quantity),
                    },
                    {
                      key: 'folio',
                      term: _('hospitality_core.reservation.field.folio'),
                      value: reservation.folio?.code ?? reservation.folioId,
                    },
                    ...(reservation.cancelReason
                      ? [
                          {
                            key: 'cancel-reason',
                            term: _('hospitality_core.reservation.field.cancelReason'),
                            value: reservation.cancelReason,
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            ...actions,
          ])}
        />,
      ])}
    />
  )
}
