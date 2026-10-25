import { HospitalityGuestForm } from './form-sections.tsx'
import { GUEST_LOYALTY_TIERS } from '../types.ts'
import {
  ActionGroup,
  Badge,
  Button,
  DescriptionList,
  LinkButton,
  Notice,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import {
  createRecordPage,
  recordIsland,
  RecordDialogTrigger,
  recordStateSelectControl,
} from '../../../ui/client/record-modal.tsx'
import type {
  RecordModalForm,
  RecordModalContext,
  RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
type Row = Record<string, unknown>
type Page = { rows: Row[]; page: number; pages: number; total: number }
type Data = {
  record: Row
  finance: Row | null
  additionalGuest: Row | null
  departure: Row | null
  departureFinance: Row | null
  localDates: { checkIn: string; checkOut: string; moveAt: string }
  can: Record<string, boolean>
  locale: string
  commandKey: string
  scope: string
  backHref: string
  refreshHref: string
  checkoutHref: string
  paging: Record<string, { previous: string | null; next: string | null }>
}
export type ReservationPageData = Data
type Context = RecordModalContext<Data>
const ReservationForm = ({
  context,
  ...props
}: Parameters<typeof RecordModalForm>[0] & { context: Context }) => (
  <HospitalityGuestForm
    {...props}
    t={context.t}
    guestOffset={context.dialog?.name === 'guest' ? Number(context.data.record.adults ?? 0) : 0}
    fields={props.fields.map((field) => ({ ...field, error: context.fieldError(field.name ?? '') }))}
  />
)
const tr = (c: Context, key: string) => c.t(`hospitality_core.${key}`)
const word = (c: Context, key: string) => c.t(`workspace.${key}`)
const str = (value: unknown) => (value == null || value === '' ? '—' : String(value))
const money = (c: Context, value: unknown) =>
  value != null && Number.isFinite(Number(value)) && /^[A-Z]{3}$/.test(String(c.data.record.currency))
    ? new Intl.NumberFormat(c.data.locale, {
        style: 'currency',
        currency: String(c.data.record.currency),
      }).format(Number(value))
    : str(value)
const row = (value: unknown) => (value ?? {}) as Row
const stay = (c: Context) => row(c.data.record.stay)
const needsContractFee = (c: Context, action: string) =>
  row(c.data.record.cancellationReview)[action === 'cancel' ? 'requiresAgreement' : 'noShowAgreement'] ===
  true
const held = (c: Context) => c.data.record.heldAssignment as Row | null
const time = (c: Context, value: unknown) =>
  value && Number.isFinite(Date.parse(String(value)))
    ? new Intl.DateTimeFormat(c.data.locale, {
        timeZone: String(row(c.data.record.property).timezone),
        dateStyle: 'short',
        timeStyle: 'short',
        hourCycle: 'h23',
      }).format(new Date(String(value)))
    : '—'
const actionLabel: Record<string, string> = {
  hold: 'holdRoom',
  checkIn: 'checkIn',
  release: 'releaseRoomHold',
  cancel: 'cancel',
  noShow: 'noShow',
  amend: 'amend',
  departure: 'adjustDeparture',
  move: 'moveRoom',
  guest: 'addGuest',
  checkout: 'checkOut',
  arrivalPlan: 'arrivalPlan',
  guestBenefits: 'guestBenefits',
}
const financeText = (c: Context, key: string) => c.t(`hospitality_billing.guarantee.${key}`)
const eligible = (c: Context, action: string): boolean => {
  const state = c.data.record.state
  if (action === 'deposit')
    return state === 'confirmed' && c.data.can.takeDeposit === true && !c.data.record.guaranteeValid
  if (action === 'guarantee') return state === 'confirmed' && c.data.can.setGuarantee === true
  if (action === 'checkout') return state === 'checked_in' && c.data.can.checkOut === true
  if (action === 'guest') return state === 'checked_in' && c.data.can.addInHouseGuest === true
  if (action === 'move') return state === 'checked_in' && c.data.can.moveRoom === true
  if (action === 'departure') return state === 'checked_in' && c.data.can.adjustStayDeparture === true
  const permission: Record<string, string> = {
    hold: 'holdRoom',
    release: 'releaseRoomHold',
    checkIn: 'checkIn',
    cancel: 'cancelReservation',
    noShow: 'markNoShow',
    amend: 'amendReservation',
    arrivalPlan: 'setReservationArrivalPlan',
    guestBenefits: 'setReservationGuestBenefits',
  }
  if (state !== 'confirmed' || !c.data.can[permission[action] ?? '']) return false
  if ((action === 'amend' || action === 'cancel') && c.data.record.provider !== 'direct') return false
  if (
    action === 'checkIn' &&
    !c.data.record.guaranteeValid &&
    !(c.data.can.arrive && (c.data.can.takeDeposit || c.data.can.setGuarantee))
  )
    return false
  if (['hold', 'checkIn', 'release'].includes(action) && !stay(c).id) return false
  if (action === 'release' && !held(c)) return false
  return true
}
const title = (c: Context, action: string) =>
  action === 'deposit' || action === 'guarantee'
    ? financeText(c, action === 'deposit' ? 'takeDeposit' : 'record')
    : tr(c, `reservation.action.${actionLabel[action]}`)
const formId = (action: string) => `reservation-${action}-form`
const submit = (c: Context, action: string) => (
  <Button
    type="submit"
    form={formId(action)}
    name="__command"
    value={action === 'checkIn' && c.data.can.arrive ? 'arrival' : action}
    label={
      action === 'arrivalPlan'
        ? tr(c, 'reservation.arrivalPlan.save')
        : action === 'guestBenefits'
          ? tr(c, 'reservation.benefits.confirm')
          : title(c, action)
    }
    variant="primary"
    disabled={c.busy || !eligible(c, action)}
  />
)
const picker = (c: Context, readyOnly: boolean, moving = false) => {
  const assignment = held(c),
    assigned = row(assignment?.room),
    selected = moving || (readyOnly && assigned.status !== 'available') ? {} : assigned
  return recordIsland('backend.relation-select', {
    id: readyOnly ? 'reservation-check-in-room' : 'reservation-held-room',
    config: {
      name: 'roomId',
      ariaLabel: tr(c, 'reservation.field.room'),
      required: true,
      value: c.draft('roomId', selected.id ? String(selected.id) : ''),
      options: selected.id ? [{ value: selected.id, label: selected.name }] : [],
      labels: Object.fromEntries(
        [
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
        ].map((key) => [key, c.t(`backend.relation.${key}`)]),
      ),
      manager: {
        listFunction: 'hospitality_core.lookupReservationRooms',
        listInput: { reservationId: c.id, readyOnly, moving },
        searchInDropdown: true,
        requestQuery: c.data.scope,
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    },
  })
}
const guestCount = (c: Context) => Math.min(50, Math.max(1, Number(c.data.record.adults) || 1))
const declarationGuests = (form: FormData, c: Context) =>
  Array.from({ length: guestCount(c) }, (_, index) => ({
    ...Object.fromEntries(
      ['fullName', 'type', 'number', 'birth', 'gender', 'nationality'].map((key) => [
        key,
        String(form.get(`guest-${index}-${key}`) ?? ''),
      ]),
    ),
    partnerId:
      (c.data.record.arrivalGuests as Row[] | undefined)?.[index]?.partnerId ??
      (index === 0 ? c.data.record.partnerId : undefined),
  }))
const guestDeclarationFields = (
  c: Context,
  additional = false,
): Parameters<typeof RecordModalForm>[0]['fields'] => {
  const countryNames = new Intl.DisplayNames([c.data.locale], { type: 'region' })
  return Array.from({ length: additional ? 1 : guestCount(c) }, (_, index) => {
    const label = (key: string) =>
      c.t('hospitality_core.reservation.guestLabel', {
        number: additional ? Number(c.data.record.adults) + 1 : index + 1,
        field: tr(c, `stay.document.${key === 'birth' ? 'dateOfBirth' : key}`),
      })
    const field = (key: string) => ({
      id: `reservation-guest-${index}-${key}`,
      name: `guest-${index}-${key}`,
      label: label(key),
      required: true,
    })
    const draft = (key: string, fallback = '') => c.draft(`guest-${index}-${key}`, fallback)
    const person = additional ? undefined : (c.data.record.arrivalGuests as Row[] | undefined)?.[index]
    return [
      {
        ...field('fullName'),
        value: draft(
          'fullName',
          String(
            person?.displayName ?? (!additional && index === 0 ? (row(c.data.record.guest).name ?? '') : ''),
          ),
        ),
        maxLength: 200,
      },
      {
        ...field('nationality'),
        type: 'select' as const,
        value: draft('nationality', 'VN'),
        options: [
          'VN',
          'KR',
          'CN',
          'TW',
          'JP',
          'RU',
          'IN',
          'AU',
          'US',
          'GB',
          'FR',
          'DE',
          'SG',
          'MY',
          'TH',
        ].map((value) => ({ value, label: countryNames.of(value) ?? value })),
      },
      {
        ...field('type'),
        type: 'select' as const,
        value: draft('type', 'cccd'),
        options: ['cccd', 'passport'].map((value) => ({ value, label: tr(c, `document.${value}`) })),
      },
      { ...field('number'), value: draft('number'), maxLength: 32 },
      {
        ...field('birth'),
        type: 'date' as const,
        value: draft('birth'),
        locale: c.data.locale === 'en' ? ('en' as const) : ('vi' as const),
      },
      {
        ...field('gender'),
        type: 'select' as const,
        value: draft('gender'),
        options: [
          { value: '', label: tr(c, 'stay.document.genderUnknown') },
          ...['male', 'female', 'other'].map((value) => ({ value, label: tr(c, `gender.${value}`) })),
        ],
      },
    ]
  }).flat()
}
const dialogForm = (c: Context, action: string) => (
  <ReservationForm
    context={c}
    kind={c.kind}
    id={formId(action)}
    fields={
      action === 'hold' || action === 'checkIn'
        ? [
            {
              id: action === 'checkIn' ? 'reservation-check-in-room' : 'reservation-held-room',
              name: 'roomId',
              label: tr(c, 'reservation.field.room'),
              required: true,
              control: picker(c, action === 'checkIn'),
            },
            ...(action === 'checkIn' && c.data.can.declareArrivalGuests ? guestDeclarationFields(c) : []),
            ...(action === 'checkIn' && row(c.data.record.arrivalFee).early
              ? [
                  {
                    id: 'reservation-early-fee',
                    name: 'earlyFee',
                    label: tr(c, 'reservation.field.earlyFee'),
                    type: 'select' as const,
                    required: true,
                    value: c.draft('earlyFee', row(c.data.record.arrivalFee).benefit ? 'waived' : 'charged'),
                    help: row(c.data.record.arrivalFee).benefit
                      ? tr(c, 'reservation.benefits.earlyHint').replace(
                          '{benefit}',
                          tr(c, `reservation.benefits.tier.${String(row(c.data.record.arrivalFee).benefit)}`),
                        )
                      : undefined,
                    options: [
                      {
                        value: 'charged',
                        label: `${tr(c, 'reservation.earlyFeeCharge')} · ${money(c, row(c.data.record.arrivalFee).amount)}`,
                      },
                      { value: 'waived', label: tr(c, 'reservation.earlyFeeWaive') },
                    ],
                  },
                ]
              : []),
            ...(action === 'checkIn' && !c.data.record.guaranteeValid ? depositArrivalFields(c) : []),
            ...(action === 'checkIn'
              ? [
                  {
                    id: 'reservation-arrival-keys',
                    name: 'keys',
                    label: tr(c, 'reservation.field.keys'),
                    type: 'number' as const,
                    min: 1,
                    max: 4,
                    step: '1',
                    required: true,
                    value: c.draft('keys', '1'),
                  },
                  {
                    id: 'reservation-early-reason',
                    name: 'earlyReason',
                    label: tr(c, 'reservation.field.earlyReason'),
                    type: 'textarea' as const,
                    value: c.draft('earlyReason', ''),
                    help: tr(
                      c,
                      row(c.data.record.arrivalFee).benefit
                        ? 'reservation.benefits.reasonHint'
                        : 'reservation.field.earlyReasonHint',
                    ),
                  },
                ]
              : []),
          ]
        : action === 'cancel' || action === 'noShow'
          ? [
              ...(needsContractFee(c, action)
                ? [
                    {
                      id: `reservation-${action}-contract-fee`,
                      name: 'contractCancellationFee',
                      label: tr(c, 'reservation.cancellation.contractAmount'),
                      type: 'number' as const,
                      required: true,
                      min: '0',
                      max: String(c.data.record.amountTotal),
                      step: 'any',
                      value: c.draft('contractCancellationFee', ''),
                      help: tr(c, 'reservation.cancellation.contractHint')
                        .replace('{total}', money(c, c.data.record.amountTotal))
                        .replace(
                          '{retained}',
                          money(
                            c,
                            action === 'noShow'
                              ? row(c.data.record.cancellationReview).retainedRoomAmount
                              : '0',
                          ),
                        ),
                    },
                  ]
                : []),
              {
                id: `reservation-${action}-reason`,
                name: 'reason',
                label: tr(c, `reservation.field.${action === 'cancel' ? 'cancelReason' : 'noShowReason'}`),
                type: 'textarea',
                value: c.draft('reason', ''),
                required: true,
              },
            ]
          : []
    }
  />
)
const eventLabel = (c: Context, value: unknown) => {
  if (value === 'chargeEarlyArrival') return tr(c, 'reservation.earlyFeeCharge')
  if (value === 'waiveEarlyArrival') return tr(c, 'reservation.earlyFeeWaive')
  if (value === 'createReservation') return tr(c, 'screen.frontDesk.event.createReservation')
  if (value === 'setGuestBenefits') return tr(c, 'reservation.action.guestBenefits')
  if (value === 'planArrival') return tr(c, 'screen.frontDesk.event.planArrival')
  if (value === 'declareArrivalGuests') return tr(c, 'reservation.guestsDeclared')
  if (value === 'reservation-guarantee') return financeText(c, 'record')
  const actions: Record<string, string> = {
    holdRoom: 'holdRoom',
    releaseRoomHold: 'releaseRoomHold',
    checkIn: 'checkIn',
    checkOut: 'checkOut',
    amendReservation: 'amend',
    adjustStayDeparture: 'adjustDeparture',
    moveRoom: 'moveRoom',
    addInHouseGuest: 'addGuest',
    cancelReservation: 'cancel',
    markNoShow: 'noShow',
  }
  return actions[String(value)]
    ? tr(c, `reservation.action.${actions[String(value)]}`)
    : word(c, 'recordUpdated')
}
const section = (c: Context, name: string) => {
  const page = c.data.record[name] as Page,
    links = c.data.paging[name]!
  return (
    <Surface
      title={word(c, name)}
      body={
        <Stack
          items={[
            page.rows.length ? (
              <DescriptionList
                items={page.rows.map((item) => ({
                  id: String(item.id),
                  label: name === 'history' ? time(c, item.occurredAt) : str(row(item.room).name),
                  value:
                    name === 'history'
                      ? eventLabel(c, item.action)
                      : `${time(c, item.startAt)} – ${time(c, item.endAt)} · ${tr(c, `assignmentState.${item.state}`)}`,
                }))}
              />
            ) : (
              <Text variant="bodyMd">{word(c, 'empty')}</Text>
            ),
            <ActionGroup
              actions={[
                <LinkButton
                  label={word(c, 'previous')}
                  href={links.previous ?? c.data.refreshHref}
                  disabled={!links.previous}
                />,
                <Text variant="bodySm">{`${page.page} / ${page.pages} · ${page.total}`}</Text>,
                <LinkButton
                  label={word(c, 'next')}
                  href={links.next ?? c.data.refreshHref}
                  disabled={!links.next}
                />,
              ]}
            />,
          ]}
        />
      }
    />
  )
}
const commands: NonNullable<RecordModalDefinition<Data>['commands']> = {}
for (const [action, fn] of Object.entries({
  hold: 'holdRoom',
  checkIn: 'checkIn',
  release: 'releaseRoomHold',
  cancel: 'cancelReservation',
  noShow: 'markNoShow',
}))
  commands[action] = {
    fn: `hospitality_core.${fn}`,
    input: (form, c) => ({
      ...(action === 'cancel' || action === 'noShow'
        ? {
            id: c.id,
            expectedVersion: c.data.record.version,
            reason: String(form.get('reason') ?? '').trim(),
            ...(needsContractFee(c, action)
              ? { contractCancellationFee: String(form.get('contractCancellationFee') ?? '') }
              : {}),
            expectedCancellationFee: row(c.data.record.cancellationReview)[
              action === 'cancel' ? 'fee' : 'noShowFee'
            ],
          }
        : {
            stayId: stay(c).id,
            expectedVersion: stay(c).version,
            ...(action === 'release' ? {} : { roomId: String(form.get('roomId') ?? '') }),
          }),
      ...(action === 'checkIn'
        ? {
            earlyReason: String(form.get('earlyReason') ?? '').trim(),
            earlyFee: String(form.get('earlyFee') ?? ''),
            keys: Number(form.get('keys')),
          }
        : {}),
      ...(action === 'checkIn' && c.data.can.declareArrivalGuests
        ? { guests: declarationGuests(form, c) }
        : {}),
      requestKey: `${c.data.commandKey}:${action}`,
    }),
    after: 'reload',
  }
commands.arrival = {
  fn: 'hospitality_billing.arriveReservation',
  input: (form, c) => ({
    reservationId: c.id,
    roomId: String(form.get('roomId') ?? ''),
    earlyReason: String(form.get('earlyReason') ?? '').trim(),
    earlyFee: String(form.get('earlyFee') ?? ''),
    keys: Number(form.get('keys')),
    expectedVersion: c.data.record.version,
    expectedStayVersion: Number(stay(c).version ?? 0),
    requestKey: `${c.data.commandKey}:arrival`,
    ...(c.data.can.declareArrivalGuests ? { guests: declarationGuests(form, c) } : {}),
    kind: c.data.record.guaranteeValid ? 'existing' : String(form.get('kind') ?? ''),
    ...(!c.data.record.guaranteeValid
      ? {
          amount: String(form.get('amount') ?? ''),
          ...(form.get('journalId') ? { journalId: String(form.get('journalId')) } : {}),
          reference: String(form.get('reference') ?? ''),
        }
      : {}),
  }),
  after: 'reload',
}
const dialogs: NonNullable<RecordModalDefinition<Data>['dialogs']> = {}
commands.checkout = {
  fn: 'hospitality_core.checkOut',
  input: (f, c) => ({
    stayId: stay(c).id,
    expectedVersion: stay(c).version,
    requestKey: `${c.data.commandKey}:checkout`,
    handover: ['keys', 'charges'].filter((key) => f.get(`handover-${key}`) === 'yes'),
    departureNotes: String(f.get('departureNotes') ?? ''),
    lateReason: String(f.get('lateReason') ?? ''),
  }),
  after: 'reload',
}
dialogs.checkout = {
  title: (c) => title(c, 'checkout'),
  size: 'large',
  view: (c) => {
    const data = c.data.departure
    if (!eligible(c, 'checkout') || !data) return <Text>{word(c, 'unavailable')}</Text>
    const charges = (data.charges ?? []) as Row[],
      blockers = (data.blockers ?? []) as Row[],
      page = row(data.chargesPage)
    const pageHref = (value: number) => {
      const url = new URL(c.data.refreshHref, 'http://hospitality.local')
      url.searchParams.set('dialog', 'checkout')
      url.searchParams.set('checkoutPage', String(value))
      return url.pathname + url.search
    }
    return (
      <Stack
        items={[
          <Surface
            title={tr(c, 'reservation.checkout.charges')}
            body={
              <DescriptionList
                items={charges.map((charge) => ({
                  id: String(charge.id),
                  label:
                    charge.type === 'room' && String(charge.description).startsWith('room:')
                      ? tr(c, 'folio.charge.roomDescription')
                      : String(charge.description),
                  value: money(c, charge.amount),
                }))}
              />
            }
          />,
          Number(page.pages) > 1 ? (
            <ActionGroup
              actions={[
                Number(page.page) > 1 ? (
                  <LinkButton href={pageHref(Number(page.page) - 1)} label={word(c, 'previous')} />
                ) : null,
                <Text>
                  {String(page.page)} / {String(page.pages)} · {String(page.total)}
                </Text>,
                Number(page.page) < Number(page.pages) ? (
                  <LinkButton href={pageHref(Number(page.page) + 1)} label={word(c, 'next')} />
                ) : null,
              ]}
            />
          ) : null,
          <DescriptionList
            items={[
              { id: 'total', label: tr(c, 'reservation.checkout.total'), value: money(c, data.balance) },
              ...(c.data.departureFinance
                ? [
                    {
                      id: 'paid',
                      label: tr(c, 'reservation.checkout.paid'),
                      value:
                        c.data.departureFinance.balanceKnown === false
                          ? '—'
                          : money(c, c.data.departureFinance.paid),
                    },
                    {
                      id: 'balance',
                      label: tr(c, 'reservation.checkout.balance'),
                      value:
                        c.data.departureFinance.balanceKnown === false
                          ? '—'
                          : money(c, c.data.departureFinance.balance),
                    },
                  ]
                : []),
            ]}
          />,
          <Text>{tr(c, 'reservation.checkout.paymentHint')}</Text>,
          ...blockers.map((item, index) => (
            <Text>{c.t(String(item.messageKey ?? `hospitality_core.validation.${item.code}`))}</Text>
          )),
          ...((data.awaitingFulfilment ?? []) as Row[]).map((line) => (
            <Text>{String(line.description)}</Text>
          )),
          blockers.some((item) => item.code === 'departure_day_required') &&
          c.data.can.adjustStayDeparture ? (
            <RecordDialogTrigger dialog="departure">
              <Button label={title(c, 'departure')} />
            </RecordDialogTrigger>
          ) : null,
          data.ready ? (
            <ReservationForm
              context={c}
              kind={c.kind}
              id={formId('checkout')}
              fields={[
                {
                  id: 'departure-handover',
                  name: 'handover',
                  label: tr(c, 'reservation.checkout.handover'),
                  type: 'checkbox-group',
                  error: c.fieldError('handover'),
                  options: ['keys', 'charges'].map((key) => ({
                    name: `handover-${key}`,
                    value: 'yes',
                    label: c.t(
                      `hospitality_core.reservation.checkout.${key === 'charges' ? 'checkedCharges' : key}`,
                      { count: data.issuedKeys },
                    ),
                    checked: c.draft(`handover-${key}`, '') === 'yes',
                  })),
                },
                {
                  id: 'departure-notes',
                  name: 'departureNotes',
                  label: tr(c, 'reservation.checkout.notes'),
                  type: 'textarea',
                  maxLength: 2000,
                  value: c.draft('departureNotes', ''),
                  error: c.fieldError('departureNotes'),
                },
                ...(data.lateReasonRequired
                  ? [
                      {
                        id: 'departure-late',
                        name: 'lateReason',
                        label: tr(c, 'checkOutPrep.lateReason'),
                        type: 'textarea' as const,
                        required: true,
                        value: c.draft('lateReason', ''),
                        error: c.fieldError('lateReason'),
                      },
                    ]
                  : []),
              ]}
            />
          ) : null,
        ]}
      />
    )
  },
  actions: (c) => (eligible(c, 'checkout') && c.data.departure?.ready ? submit(c, 'checkout') : null),
}

commands.guest = {
  fn: 'hospitality_core.addInHouseGuest',
  input: (f, c) => ({
    stayId: stay(c).id,
    expectedVersion: stay(c).version,
    expectedReservationVersion: c.data.record.version,
    requestKey: `${c.data.commandKey}:guest`,
    guest: Object.fromEntries(
      ['fullName', 'type', 'number', 'birth', 'nationality', 'gender'].map((key) => [
        key,
        String(f.get(`guest-0-${key}`) ?? ''),
      ]),
    ),
    extraBed: f.get('extraBed') === 'yes',
    ...(c.data.additionalGuest?.rate != null ? { expectedBedRate: String(c.data.additionalGuest.rate) } : {}),
  }),
  after: 'reload',
}
dialogs.guest = {
  title: (c) => title(c, 'guest'),
  size: 'default',
  view: (c) => {
    const plan = c.data.additionalGuest
    if (!eligible(c, 'guest') || !plan) return <Text>{word(c, 'unavailable')}</Text>
    if (plan.full) return <Text>{tr(c, 'reservation.additionalGuest.full')}</Text>
    if (plan.needsBed && plan.rate == null)
      return <Text>{tr(c, 'reservation.additionalGuest.missingRate')}</Text>
    return (
      <Stack
        items={[
          <Text>{tr(c, 'reservation.additionalGuest.hint')}</Text>,
          <ReservationForm
            context={c}
            kind={c.kind}
            id={formId('guest')}
            fields={[
              ...guestDeclarationFields(c, true),
              ...(plan.needsBed
                ? [
                    {
                      id: 'reservation-extra-bed',
                      name: 'extraBed',
                      type: 'checkbox' as const,
                      required: true,
                      label: c.t('hospitality_core.reservation.additionalGuest.bed', {
                        rate: money(c, plan.rate),
                        nights: plan.nights,
                        amount: money(c, plan.amount),
                      }),
                      submitValue: 'yes',
                      checked: c.draft('extraBed', '') === 'yes',
                      error: c.fieldError('extraBed'),
                    },
                  ]
                : []),
            ]}
          />,
        ]}
      />
    )
  },
  actions: (c) =>
    eligible(c, 'guest') &&
    c.data.additionalGuest &&
    !c.data.additionalGuest.full &&
    (!c.data.additionalGuest.needsBed || c.data.additionalGuest.rate != null)
      ? submit(c, 'guest')
      : null,
}

commands.move = {
  route: '/admin/hospitality/reservation-command',
  input: (f, c) => ({
    operation: 'move',
    id: c.id,
    expectedVersion: stay(c).version,
    requestKey: `${c.data.commandKey}:move`,
    roomId: String(f.get('roomId') ?? ''),
    reason: String(f.get('reason') ?? ''),
    at: String(f.get('at') ?? ''),
  }),
  after: 'reload',
}
dialogs.move = {
  title: (c) => title(c, 'move'),
  size: 'small',
  view: (c) =>
    eligible(c, 'move') ? (
      <Stack
        items={[
          <Text>{tr(c, 'reservation.moveHint')}</Text>,
          <ReservationForm
            context={c}
            kind={c.kind}
            id={formId('move')}
            fields={[
              {
                id: 'reservation-move-room',
                name: 'roomId',
                label: tr(c, 'reservation.field.room'),
                required: true,
                control: picker(c, true, true),
                error: c.fieldError('roomId'),
              },
              {
                id: 'reservation-move-at',
                name: 'at',
                label: tr(c, 'reservation.field.moveAt'),
                type: 'datetime-local',
                required: true,
                locale: c.data.locale === 'en' ? 'en' : 'vi',
                value: c.draft('at', c.data.localDates.moveAt),
                error: c.fieldError('at'),
              },
              {
                id: 'reservation-move-reason',
                name: 'reason',
                label: tr(c, 'reservation.field.moveReason'),
                type: 'textarea',
                required: true,
                maxLength: 500,
                value: c.draft('reason', ''),
                error: c.fieldError('reason'),
              },
            ]}
          />,
        ]}
      />
    ) : (
      <Text>{word(c, 'unavailable')}</Text>
    ),
  actions: (c) => (eligible(c, 'move') ? submit(c, 'move') : null),
}

for (const action of ['hold', 'checkIn', 'release', 'cancel', 'noShow'])
  dialogs[action] = {
    title: (c) => title(c, action),
    size: action === 'checkIn' ? 'default' : 'small',
    view: (c) =>
      eligible(c, action) ? (
        action === 'cancel' || action === 'noShow' ? (
          <Stack
            items={[
              <DescriptionList
                items={[
                  {
                    id: 'policy',
                    label: tr(c, 'field.cancellationPolicy'),
                    value: row(c.data.record.cancellationReview).policy
                      ? tr(c, `policy.${String(row(c.data.record.cancellationReview).policy)}`)
                      : tr(c, 'reservation.cancellation.noPolicy'),
                  },
                  {
                    id: 'fee',
                    label: tr(c, 'reservation.cancellation.fee'),
                    value: needsContractFee(c, action)
                      ? tr(c, 'reservation.cancellation.byContract')
                      : money(
                          c,
                          row(c.data.record.cancellationReview)[action === 'cancel' ? 'fee' : 'noShowFee'],
                        ),
                  },
                ]}
              />,
              <Text>{tr(c, 'reservation.cancellation.effect')}</Text>,
              <Notice
                tone="info"
                title={tr(c, 'reservation.cancellation.refundTitle')}
                message={tr(c, 'reservation.cancellation.noRefund')}
              />,
              c.fieldError('review') ? (
                <Notice
                  tone="danger"
                  title={tr(c, 'reservation.cancellation.fee')}
                  message={c.fieldError('review')!}
                />
              ) : null,
              dialogForm(c, action),
            ]}
          />
        ) : (
          dialogForm(c, action)
        )
      ) : (
        <Text variant="bodyMd">{word(c, 'unavailable')}</Text>
      ),
    ...(action === 'hold' || action === 'checkIn'
      ? { actions: (c: Context) => submit(c, action) }
      : {
          confirmation: {
            message: (c: Context) =>
              action === 'cancel' || action === 'noShow'
                ? tr(c, `reservation.action.${actionLabel[action]}Hint`)
                : title(c, action),
            label: (c: Context) => title(c, action),
            cancelLabel: (c: Context) => word(c, 'cancel'),
            form: () => formId(action),
            command: action,
            variant: 'destructive' as const,
            disabled: (c: Context) =>
              c.busy ||
              !eligible(c, action) ||
              ((action === 'cancel' || action === 'noShow') && !c.data.record.cancellationReview),
          },
        }),
  }
commands.guestBenefits = {
  fn: 'hospitality_core.setReservationGuestBenefits',
  input: (form, c) => ({
    id: c.id,
    expectedVersion: c.data.record.version,
    requestKey: `${c.data.commandKey}:guestBenefits`,
    vip: form.get('vip') === 'yes',
    tier: String(form.get('tier') ?? 'none'),
    program: String(form.get('program') ?? ''),
    reference: String(form.get('reference') ?? ''),
  }),
  after: 'reload',
}
dialogs.guestBenefits = {
  title: (c) => title(c, 'guestBenefits'),
  size: 'default',
  view: (c) =>
    eligible(c, 'guestBenefits') ? (
      <Stack
        items={[
          <Text>{tr(c, 'reservation.benefits.hint')}</Text>,
          <ReservationForm
            context={c}
            kind={c.kind}
            id={formId('guestBenefits')}
            fields={[
              {
                id: 'reservation-benefit-vip',
                name: 'vip',
                label: tr(c, 'reservation.benefits.vip'),
                type: 'select',
                required: true,
                value: c.draft('vip', c.data.record.guestVip ? 'yes' : 'no'),
                options: [
                  { value: 'no', label: tr(c, 'reservation.benefits.regular') },
                  { value: 'yes', label: tr(c, 'reservation.benefits.tier.vip') },
                ],
              },
              {
                id: 'reservation-benefit-tier',
                name: 'tier',
                label: tr(c, 'reservation.benefits.tier'),
                type: 'select',
                required: true,
                value: c.draft('tier', String(c.data.record.guestLoyaltyTier ?? 'none')),
                options: GUEST_LOYALTY_TIERS.map((value) => ({
                  value,
                  label: tr(c, `reservation.benefits.tier.${value}`),
                })),
              },
              {
                id: 'reservation-benefit-program',
                name: 'program',
                label: tr(c, 'reservation.benefits.program'),
                maxLength: 80,
                value: c.draft('program', String(c.data.record.guestLoyaltyProgram ?? '')),
                help: tr(c, 'reservation.benefits.programHint'),
              },
              {
                id: 'reservation-benefit-reference',
                name: 'reference',
                label: tr(c, 'reservation.benefits.reference'),
                type: 'textarea',
                required: true,
                maxLength: 500,
                value: c.draft('reference', ''),
              },
            ]}
          />,
        ]}
      />
    ) : (
      <Text>{word(c, 'unavailable')}</Text>
    ),
  actions: (c) => (eligible(c, 'guestBenefits') ? submit(c, 'guestBenefits') : null),
}
commands.arrivalPlan = {
  fn: 'hospitality_core.setReservationArrivalPlan',
  input: (form, c) => ({
    id: c.id,
    expectedVersion: c.data.record.version,
    requestKey: `${c.data.commandKey}:arrivalPlan`,
    expectedArrivalTime: String(form.get('expectedArrivalTime') ?? ''),
    earlyArrivalRequested: form.get('earlyArrivalRequested') === 'yes',
    arrivalNote: String(form.get('arrivalNote') ?? ''),
  }),
  after: 'reload',
}
dialogs.arrivalPlan = {
  title: (c) => title(c, 'arrivalPlan'),
  size: 'small',
  actions: (c) => submit(c, 'arrivalPlan'),
  view: (c) =>
    eligible(c, 'arrivalPlan') ? (
      <ReservationForm
        context={c}
        kind={c.kind}
        id={formId('arrivalPlan')}
        columns={1}
        fields={[
          {
            id: 'reservation-arrival-time',
            name: 'expectedArrivalTime',
            label: tr(c, 'reservation.field.expectedArrivalTime'),
            type: 'time',
            value: c.draft('expectedArrivalTime', String(c.data.record.expectedArrivalTime ?? '')),
          },
          {
            id: 'reservation-arrival-request',
            name: 'earlyArrivalRequested',
            label: tr(c, 'reservation.field.earlyArrivalRequested'),
            type: 'select',
            required: true,
            value: c.draft('earlyArrivalRequested', c.data.record.earlyArrivalRequested ? 'yes' : 'no'),
            options: [
              { value: 'no', label: tr(c, 'reservation.arrivalPlan.normal') },
              { value: 'yes', label: tr(c, 'reservation.arrivalPlan.early') },
            ],
          },
          {
            id: 'reservation-arrival-note',
            name: 'arrivalNote',
            label: tr(c, 'reservation.field.arrivalNote'),
            type: 'textarea',
            value: c.draft('arrivalNote', String(c.data.record.arrivalNote ?? '')),
          },
        ]}
      />
    ) : (
      <Text variant="bodyMd">{word(c, 'unavailable')}</Text>
    ),
}
const amendmentRelation = (c: Context, name: 'partnerId' | 'roomTypeId') => {
  const guest = name === 'partnerId',
    selected = row(guest ? c.data.record.guest : c.data.record.roomType),
    label = tr(c, `reservation.field.${guest ? 'guest' : 'roomType'}`)
  return {
    id: `reservation-amend-${name}`,
    name,
    label,
    required: true,
    control: recordIsland('backend.relation-select', {
      id: `reservation-amend-${name}`,
      config: {
        name,
        ariaLabel: label,
        required: true,
        value: c.draft(name, str(c.data.record[name])),
        options: selected.id ? [{ value: selected.id, label: selected.name }] : [],
        labels: {
          ...Object.fromEntries(
            [
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
            ].map((key) => [key, c.t(`backend.relation.${key}`)]),
          ),
          dialogTitle: label,
        },
        manager: {
          listFunction: guest
            ? 'hospitality_core.lookupReservationGuests'
            : 'hospitality_core.lookupRoomTypes',
          listInput: guest ? { reservationId: c.id } : { propertyId: c.data.record.propertyId },
          searchInDropdown: true,
          requestQuery: c.data.scope,
          limit: 20,
          resolveParam: 'id',
          idField: 'id',
          labelField: 'name',
        },
      },
    }),
  }
}
for (const action of ['amend', 'departure']) {
  commands[action] = {
    route: '/admin/hospitality/reservation-command',
    input: (form, c) => ({
      operation: action,
      id: c.id,
      expectedVersion: action === 'amend' ? c.data.record.version : stay(c).version,
      requestKey: `${c.data.commandKey}:${action}`,
      ...Object.fromEntries(
        (action === 'amend'
          ? ['partnerId', 'roomTypeId', 'checkIn', 'checkOut', 'adults', 'children', 'rate']
          : ['checkOut']
        ).map((key) => [key, String(form.get(key) ?? '')]),
      ),
    }),
    after: 'reload',
  }
  dialogs[action] = {
    title: (c) => title(c, action),
    size: action === 'amend' ? 'large' : 'small',
    view: (c) =>
      eligible(c, action) ? (
        <ReservationForm
          context={c}
          kind={c.kind}
          id={formId(action)}
          columns={action === 'amend' ? 2 : 1}
          fields={[
            ...(action === 'amend'
              ? [
                  amendmentRelation(c, 'partnerId'),
                  amendmentRelation(c, 'roomTypeId'),
                  {
                    id: 'reservation-amend-check-in',
                    name: 'checkIn',
                    label: tr(c, 'col.checkIn'),
                    type: 'datetime-local' as const,
                    locale: c.data.locale === 'en' ? ('en' as const) : ('vi' as const),
                    required: true,
                    value: c.draft('checkIn', c.data.localDates.checkIn),
                  },
                ]
              : []),
            {
              id: `reservation-${action}-check-out`,
              name: 'checkOut',
              label: tr(c, 'col.checkOut'),
              type: 'datetime-local',
              locale: c.data.locale === 'en' ? 'en' : 'vi',
              required: true,
              value: c.draft('checkOut', c.data.localDates.checkOut),
            },
            ...(action === 'amend'
              ? ['adults', 'children', 'rate'].map((name) => ({
                  id: `reservation-amend-${name}`,
                  name,
                  label: tr(c, `reservation.field.${name}`),
                  type: name === 'rate' ? ('decimal' as const) : ('number' as const),
                  required: true,
                  value: c.draft(name, str(c.data.record[name])),
                }))
              : []),
          ]}
        />
      ) : (
        <Text variant="bodyMd">{word(c, 'unavailable')}</Text>
      ),
    actions: (c) => (eligible(c, action) ? submit(c, action) : null),
  }
}
const financeRelation = (c: Context, name: 'paymentId' | 'journalId', selected = '') => {
  const label = financeText(c, name === 'paymentId' ? 'paymentEvidence' : 'journal')
  return {
    id: `reservation-finance-${name}`,
    name,
    label,
    required: true,
    control: recordIsland('backend.relation-select', {
      id: `reservation-finance-${name}`,
      config: {
        name,
        ariaLabel: label,
        required: true,
        value: c.draft(name, selected),
        options: [],
        labels: {
          ...Object.fromEntries(
            [
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
            ].map((key) => [key, c.t(`backend.relation.${key}`)]),
          ),
          dialogTitle: label,
        },
        manager: {
          listFunction:
            name === 'paymentId'
              ? 'hospitality_billing.lookupReservationGuaranteePayments'
              : 'hospitality_billing.lookupReservationGuaranteeJournals',
          listInput: { reservationId: c.id },
          searchInDropdown: true,
          requestQuery: c.data.scope,
          limit: 20,
          resolveParam: 'id',
          idField: 'id',
          labelField: 'name',
          ...(name === 'paymentId' ? { descriptionField: 'available' } : {}),
        },
      },
    }),
  }
}
const depositArrivalFields = (c: Context) => {
  const kind = c.state('arrivalKind', c.draft('kind', c.data.can.takeDeposit ? 'collect' : 'card'))
  return [
    {
      id: 'reservation-arrival-kind',
      name: 'kind',
      label: financeText(c, 'kind'),
      type: 'select' as const,
      control: recordStateSelectControl({
        id: 'reservation-arrival-kind',
        name: 'kind',
        state: 'arrivalKind',
        value: kind,
        options: [
          ...(c.data.can.takeDeposit ? [{ value: 'collect', label: financeText(c, 'takeDeposit') }] : []),
          ...(c.data.can.setGuarantee ? [{ value: 'card', label: financeText(c, 'card') }] : []),
        ],
      }),
    },
    {
      id: 'reservation-arrival-amount',
      name: 'amount',
      label: financeText(c, 'amount'),
      type: 'decimal' as const,
      required: true,
      value: c.draft('amount', ''),
    },
    ...(kind === 'collect' ? [financeRelation(c, 'journalId')] : []),
    {
      id: 'reservation-arrival-reference',
      name: 'reference',
      label: financeText(c, kind === 'card' ? 'authorization' : 'reference'),
      value: c.draft('reference', ''),
      maxLength: kind === 'card' ? 80 : 120,
      required: kind === 'card',
      help: kind === 'card' ? financeText(c, 'authorizationHint') : undefined,
    },
  ]
}
const guaranteeKind = (c: Context) =>
  c.state(
    'guaranteeKind',
    c.draft(
      'kind',
      row(c.data.finance?.booking).guaranteeKind === 'none'
        ? 'card'
        : str(row(c.data.finance?.booking).guaranteeKind),
    ),
  )
for (const action of ['deposit', 'guarantee']) {
  commands[action] = {
    fn:
      action === 'deposit'
        ? 'hospitality_billing.takeReservationGuarantee'
        : 'hospitality_billing.setReservationGuarantee',
    input: (form, c) => ({
      reservationId: c.id,
      expectedVersion: row(c.data.finance?.booking).version,
      requestKey: `${c.data.commandKey}:${action}`,
      amount: String(form.get('amount') ?? '0'),
      ...(action === 'deposit'
        ? {
            journalId: String(form.get('journalId') ?? ''),
            reference: String(form.get('reference') ?? ''),
            memo: String(form.get('memo') ?? ''),
          }
        : {
            kind: String(form.get('kind') ?? ''),
            ...(form.get('paymentId') ? { paymentId: String(form.get('paymentId')) } : {}),
            ...(form.get('reference') ? { reference: String(form.get('reference')) } : {}),
          }),
    }),
    after: 'reload',
  }
  dialogs[action] = {
    title: (c) => title(c, action),
    size: 'small',
    view: (c) => {
      if (!eligible(c, action)) return <Text variant="bodyMd">{word(c, 'unavailable')}</Text>
      const booking = row(c.data.finance?.booking),
        kind = guaranteeKind(c),
        evidence = kind === 'deposit' || kind === 'prepaid'
      return (
        <ReservationForm
          context={c}
          kind={c.kind}
          id={formId(action)}
          columns={1}
          fields={[
            ...(action === 'guarantee'
              ? [
                  {
                    id: 'reservation-guarantee-kind',
                    name: 'kind',
                    label: financeText(c, 'kind'),
                    type: 'select' as const,
                    control: recordStateSelectControl({
                      id: 'reservation-guarantee-kind',
                      name: 'kind',
                      state: 'guaranteeKind',
                      value: kind,
                      options: [
                        'card',
                        'deposit',
                        'prepaid',
                        ...(['direct', 'website', 'walk_in'].includes(String(c.data.record.provider))
                          ? []
                          : ['agent']),
                      ].map((value) => ({ value, label: financeText(c, value) })),
                    }),
                  },
                ]
              : []),
            ...(action === 'deposit' || kind !== 'agent'
              ? [
                  {
                    id: `reservation-${action}-amount`,
                    name: 'amount',
                    label: financeText(c, 'amount'),
                    type: 'decimal' as const,
                    required: true,
                    value: c.draft(
                      'amount',
                      action === 'deposit' ? '' : String(booking.guaranteeAmount ?? ''),
                    ),
                  },
                ]
              : []),
            ...(action === 'deposit'
              ? [financeRelation(c, 'journalId')]
              : evidence
                ? [
                    financeRelation(
                      c,
                      'paymentId',
                      ['deposit', 'prepaid'].includes(String(booking.guaranteeKind))
                        ? String(booking.guaranteeReference ?? '')
                        : '',
                    ),
                  ]
                : []),
            ...(action === 'deposit' || !evidence
              ? [
                  {
                    id: `reservation-${action}-reference`,
                    name: 'reference',
                    label: financeText(c, action === 'deposit' ? 'reference' : 'authorization'),
                    value: c.draft(
                      'reference',
                      action === 'guarantee' && ['card', 'agent'].includes(String(booking.guaranteeKind))
                        ? String(booking.guaranteeReference ?? '')
                        : '',
                    ),
                    required: action === 'guarantee',
                    maxLength: action === 'deposit' ? 120 : 80,
                    help: action === 'guarantee' ? financeText(c, 'authorizationHint') : undefined,
                  },
                ]
              : []),
            ...(action === 'deposit'
              ? [
                  {
                    id: 'reservation-deposit-memo',
                    name: 'memo',
                    label: financeText(c, 'note'),
                    type: 'textarea' as const,
                    value: c.draft('memo', ''),
                    maxLength: 2000,
                  },
                ]
              : []),
          ]}
        />
      )
    },
    actions: (c) => (eligible(c, action) ? submit(c, action) : null),
  }
}
export const reservationPage = createRecordPage<Data>(
  {
    kind: 'hospitality.reservation',
    size: 'large',
    cache: false,
    context: {
      route: (id) => `/admin/hospitality/reservations/${encodeURIComponent(id)}/record-context`,
      query: [
        'company',
        'companies',
        'branch',
        'branches',
        'lang',
        'returnTo',
        'assignmentPage',
        'historyPage',
        'checkoutPage',
      ],
    },
    title: (c) => tr(c, 'reservation.detail.title').replace('{code}', str(c.data.record.code)),
    status: (c) => <Badge label={tr(c, `reservationState.${c.data.record.state}`)} />,
    body: (c) => (
      <Stack
        items={[
          <Surface
            title={tr(c, 'reservation.detail.stay')}
            body={
              <DescriptionList
                items={[
                  ...(stay(c).state === 'checked_out'
                    ? [
                        {
                          id: 'departed-at',
                          label: tr(c, 'reservation.checkout.completedAt'),
                          value: time(c, stay(c).checkedOutAt),
                        },
                        {
                          id: 'departure-checks',
                          label: tr(c, 'reservation.checkout.handover'),
                          value: tr(
                            c,
                            Array.isArray(stay(c).departureChecklist) &&
                              ['keys', 'charges'].every((key) =>
                                (stay(c).departureChecklist as unknown[]).includes(key),
                              )
                              ? 'reservation.checkout.confirmed'
                              : 'reservation.checkout.unrecorded',
                          ),
                        },
                        {
                          id: 'departure-note',
                          label: tr(c, 'reservation.checkout.notes'),
                          value: str(stay(c).departureNotes),
                        },
                      ]
                    : []),
                  {
                    id: 'issued-keys',
                    label: tr(c, 'reservation.field.keys'),
                    value: str(stay(c).issuedKeys),
                  },
                  {
                    id: 'guest',
                    label: tr(c, 'reservation.field.guest'),
                    value: str(row(c.data.record.guest).name),
                  },
                  {
                    id: 'vip',
                    label: tr(c, 'reservation.benefits.vip'),
                    value: tr(
                      c,
                      c.data.record.guestVip
                        ? 'reservation.benefits.tier.vip'
                        : 'reservation.benefits.regular',
                    ),
                  },
                  {
                    id: 'loyalty',
                    label: tr(c, 'reservation.benefits.tier'),
                    value: tr(
                      c,
                      `reservation.benefits.tier.${String(c.data.record.guestLoyaltyTier ?? 'none')}`,
                    ),
                  },
                  ...(c.data.record.guestLoyaltyProgram
                    ? [
                        {
                          id: 'loyalty-program',
                          label: tr(c, 'reservation.benefits.program'),
                          value: str(c.data.record.guestLoyaltyProgram),
                        },
                      ]
                    : []),

                  {
                    id: 'roomType',
                    label: tr(c, 'reservation.field.roomType'),
                    value: str(row(c.data.record.roomType).name),
                  },
                  {
                    id: 'room',
                    label: tr(c, 'reservation.field.room'),
                    value: str(row(c.data.record.room).name ?? row(held(c)?.room).name),
                  },
                  ...(c.data.record.state === 'cancelled' || c.data.record.state === 'no_show'
                    ? [
                        {
                          id: 'reason',
                          label: tr(
                            c,
                            c.data.record.state === 'cancelled'
                              ? 'reservation.field.cancelReason'
                              : 'reservation.field.noShowReason',
                          ),
                          value: str(
                            c.data.record.state === 'cancelled'
                              ? c.data.record.cancelReason
                              : c.data.record.noShowReason,
                          ),
                        },
                      ]
                    : []),
                  { id: 'in', label: tr(c, 'col.checkIn'), value: time(c, c.data.record.checkIn) },
                  { id: 'out', label: tr(c, 'col.checkOut'), value: time(c, c.data.record.checkOut) },
                  {
                    id: 'adults',
                    label: tr(c, 'reservation.field.adults'),
                    value: str(c.data.record.adults),
                  },
                  {
                    id: 'children',
                    label: tr(c, 'reservation.field.children'),
                    value: str(c.data.record.children),
                  },
                  {
                    id: 'folio',
                    label: tr(c, 'reservation.field.folio'),
                    value: str(row(c.data.record.folio).code),
                  },
                ]}
              />
            }
          />,
          <Surface
            title={word(c, 'pricing')}
            body={
              <DescriptionList
                items={[
                  {
                    id: 'provider',
                    label: tr(c, 'col.provider'),
                    value: tr(c, `provider.${c.data.record.provider}`),
                  },
                  { id: 'rate', label: tr(c, 'reservation.field.rate'), value: money(c, c.data.record.rate) },
                  {
                    id: 'quantity',
                    label: tr(c, 'reservation.quote.quantity'),
                    value: str(c.data.record.quantity),
                  },
                  { id: 'total', label: tr(c, 'col.amount'), value: money(c, c.data.record.amountTotal) },
                  {
                    id: 'cycle',
                    label: tr(c, 'reservation.field.bookingType'),
                    value: tr(c, `bookingType.${c.data.record.bookingType}`),
                  },
                  {
                    id: 'billing',
                    label: tr(c, 'reservation.field.billingMode'),
                    value: tr(c, `billing.${c.data.record.billingMode}`),
                  },
                ]}
              />
            }
          />,
          <Surface
            title={word(c, 'guarantee')}
            body={
              <Stack
                items={[
                  <Badge
                    tone={
                      c.data.record.guaranteeValid
                        ? 'positive'
                        : c.data.record.state === 'confirmed'
                          ? 'warning'
                          : 'neutral'
                    }
                    label={word(
                      c,
                      c.data.record.guaranteeValid
                        ? 'guaranteed'
                        : c.data.record.state === 'confirmed'
                          ? 'missingGuarantee'
                          : 'noGuarantee',
                    )}
                  />,
                  c.data.finance ? (
                    <DescriptionList
                      items={[
                        {
                          id: 'guarantee-kind',
                          label: financeText(c, 'kind'),
                          value: financeText(c, String(row(c.data.finance.booking).guaranteeKind ?? 'none')),
                        },
                        {
                          id: 'guarantee-amount',
                          label: financeText(c, 'amount'),
                          value: money(c, row(c.data.finance.booking).guaranteeAmount),
                        },
                      ]}
                    />
                  ) : null,
                  c.data.can.finance && c.data.record.state === 'confirmed' ? (
                    <ActionGroup
                      actions={[
                        eligible(c, 'deposit') ? (
                          <RecordDialogTrigger dialog="deposit">
                            <Button
                              label={financeText(c, 'takeDeposit')}
                              variant="primary"
                              disabled={c.busy}
                            />
                          </RecordDialogTrigger>
                        ) : null,
                        eligible(c, 'guarantee') ? (
                          <RecordDialogTrigger dialog="guarantee">
                            <Button label={financeText(c, 'record')} disabled={c.busy} />
                          </RecordDialogTrigger>
                        ) : null,
                      ]}
                    />
                  ) : null,
                ]}
              />
            }
          />,
          <Surface
            title={tr(c, 'reservation.action.arrivalPlan')}
            body={
              <DescriptionList
                items={[
                  {
                    id: 'expected-arrival',
                    label: tr(c, 'reservation.field.expectedArrivalTime'),
                    value: str(c.data.record.expectedArrivalTime),
                  },
                  {
                    id: 'arrival-request',
                    label: tr(c, 'reservation.field.earlyArrivalRequested'),
                    value: tr(
                      c,
                      c.data.record.earlyArrivalRequested
                        ? 'reservation.arrivalPlan.early'
                        : 'reservation.arrivalPlan.normal',
                    ),
                  },
                  {
                    id: 'arrival-note',
                    label: tr(c, 'reservation.field.arrivalNote'),
                    value: str(c.data.record.arrivalNote),
                  },
                ]}
              />
            }
          />,
          <Surface
            title={tr(c, 'reservation.stayingGuests')}
            body={
              <DescriptionList
                items={((c.data.record.arrivalGuests ?? []) as Row[]).map((guest, index) => ({
                  id: String(guest.id),
                  label: c.t('hospitality_core.reservation.guestLabel', {
                    number: index + 1,
                    field: tr(c, 'stay.document.fullName'),
                  }),
                  value: String(guest.displayName ?? '—'),
                }))}
              />
            }
          />,
          section(c, 'assignments'),
          section(c, 'history'),
        ]}
      />
    ),
    pageActions: (c) => {
      const confirmed = c.data.record.state === 'confirmed',
        checkedIn = c.data.record.state === 'checked_in'
      const trigger = (action: string) => (
        <RecordDialogTrigger dialog={action}>
          <Button
            label={title(c, action)}
            disabled={c.busy}
            variant={action === 'checkIn' ? 'primary' : 'secondary'}
          />
        </RecordDialogTrigger>
      )
      return (
        <ActionGroup
          actions={[
            <LinkButton label={word(c, 'back')} href={c.data.backHref} />,
            eligible(c, 'checkIn') ? trigger('checkIn') : null,
            eligible(c, 'arrivalPlan') ? trigger('arrivalPlan') : null,
            eligible(c, 'guestBenefits') ? trigger('guestBenefits') : null,
            confirmed && c.data.can.holdRoom ? trigger('hold') : null,
            confirmed && held(c) && c.data.can.releaseRoomHold ? trigger('release') : null,
            confirmed && c.data.record.provider === 'direct' && c.data.can.amendReservation
              ? trigger('amend')
              : null,
            eligible(c, 'move') ? trigger('move') : null,
            eligible(c, 'guest') ? trigger('guest') : null,
            checkedIn && c.data.can.adjustStayDeparture ? trigger('departure') : null,
            eligible(c, 'checkout') ? trigger('checkout') : null,
            confirmed && c.data.record.provider === 'direct' && c.data.can.cancelReservation
              ? trigger('cancel')
              : null,
            confirmed && c.data.can.markNoShow ? trigger('noShow') : null,
            <LinkButton label={word(c, 'refresh')} href={c.data.refreshHref} />,
          ]}
        />
      )
    },
    commands,
    dialogs,
  },
  { path: (id) => `/admin/hospitality/reservations/${encodeURIComponent(id)}` },
)
