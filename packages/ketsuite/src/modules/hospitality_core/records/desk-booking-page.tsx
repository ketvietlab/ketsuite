import { HospitalityGuestForm } from './form-sections.tsx'
import {
  ActionGroup,
  Badge,
  Button,
  DescriptionList,
  KetTable,
  LinkButton,
  Notice,
  RecordForm,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordPage, recordIsland, recordStateSelectControl } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'

type Row = Record<string, unknown>
export type DeskBookingData = {
  record: Row | null
  query: Row
  results: Row | null
  quote: Row | null
  quoteErrors: Row[]
  can: Record<string, boolean>
  locale: 'vi' | 'en'
  scope: string
  backHref: string
  commandKey: string
}
type Context = RecordModalContext<DeskBookingData>
const label = (c: Context, key: string) => c.t(`hospitality_core.deskBooking.${key}`)
const row = (v: unknown) => (v ?? {}) as Row
const money = (c: Context, v: unknown) =>
  new Intl.NumberFormat(c.data.locale, {
    style: 'currency',
    currency: String(c.data.record?.currency ?? 'VND'),
  }).format(Number(v ?? 0))
const href = (c: Context, values: Row) => {
  const q = new URLSearchParams(c.data.scope)
  for (const [key, value] of Object.entries(values))
    if (value != null && value !== '')
      q.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  return `/admin/hospitality/reservations/new?${q}`
}
const errorText = (c: Context, error: Row) =>
  c.t(String(error.messageKey ?? `hospitality_core.validation.${error.code}`), row(error.params))
const field = (c: Context, name: string, extra: Partial<FieldProps> = {}): FieldProps => ({
  id: `desk-${name}`,
  name,
  label: label(c, name),
  value: c.draft(name, ''),
  error: c.fieldError(name),
  ...extra,
})
const picker = (c: Context, name: string, fn: string, input: Row = {}, value = '') =>
  recordIsland('backend.relation-select', {
    id: `desk-${name}-picker`,
    config: {
      name,
      ariaLabel: label(c, name),
      value: c.draft(name, value) || null,
      options: [],
      labels: Object.fromEntries(
        [
          'choose',
          'search',
          'more',
          'noRecords',
          'loading',
          'loadError',
          'dialogTitle',
          'close',
          'select',
          'create',
          'edit',
          'cancel',
          'remove',
          'confirmRemove',
          'retry',
          'clear',
          'chosen',
        ].map((key) => [key, c.t(`hospitality_core.collection.lookup.${key}`)]),
      ),
      manager: {
        listFunction: fn,
        listInput: input,
        requestQuery: c.data.scope,
        searchInDropdown: true,
        limit: 20,
        resolveParam: 'id',
        idField: 'id',
        labelField: 'name',
      },
    },
  })
const scopeFields = (c: Context): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(c.data.scope))
    result[key] =
      result[key] == null
        ? value
        : [...(Array.isArray(result[key]) ? (result[key] as string[]) : [result[key] as string]), value]
  return result
}
const isWalkIn = (c: Context) => c.data.query.walkIn === true
const guestMode = (c: Context) => c.state('guestMode', c.draft('guestMode', 'new'))
const guaranteeKind = (c: Context) =>
  c.state(
    'bookingGuarantee',
    c.draft('kind', isWalkIn(c) ? (c.data.can.collect ? 'collect' : 'card') : 'none'),
  )
const queryInput = (c: Context) => ({
  propertyId: String(c.data.query.propertyId),
  arrival: String(c.data.query.arrival),
  departure: String(c.data.query.departure),
  adults: Number(c.data.query.adults),
  children: Number(c.data.query.children),
  walkIn: isWalkIn(c),
})

const walkInFields = (c: Context): FieldProps[] => {
  const countryNames = new Intl.DisplayNames([c.data.locale], { type: 'region' })
  const fee = c.data.quote?.earlyArrival === true
  const tr = (key: string) => c.t(`hospitality_core.${key}`)
  const people = Array.from({ length: Number(c.data.query.adults) }, (_, index) => {
    const guest = (key: string, extra: Partial<FieldProps> = {}): FieldProps =>
      field(c, `guest-${index}-${key}`, {
        label: tr('reservation.guestLabel')
          .replace('{number}', String(index + 1))
          .replace('{field}', tr(`stay.document.${key === 'birth' ? 'dateOfBirth' : key}`)),
        required: true,
        ...extra,
      })
    return [
      guest('fullName', { maxLength: 200 }),
      guest('nationality', {
        type: 'select',
        value: c.draft(`guest-${index}-nationality`, 'VN'),
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
      }),
      guest('type', {
        type: 'select',
        value: c.draft(`guest-${index}-type`, 'cccd'),
        options: ['cccd', 'passport'].map((value) => ({ value, label: tr(`document.${value}`) })),
      }),
      guest('number', { maxLength: 32 }),
      guest('birth', { type: 'date', locale: c.data.locale }),
      guest('gender', {
        type: 'select',
        options: [
          { value: '', label: tr('stay.document.genderUnknown') },
          ...['male', 'female', 'other'].map((value) => ({ value, label: tr(`gender.${value}`) })),
        ],
      }),
    ]
  }).flat()
  return [
    field(c, 'roomId', {
      required: true,
      control: picker(c, 'roomId', 'hospitality_core.lookupDeskRooms', {
        ...queryInput(c),
        ratePlanId: c.data.query.ratePlanId,
      }),
    }),
    field(c, 'keys', {
      required: true,
      type: 'number',
      min: 1,
      max: 4,
      step: '1',
      value: c.draft('keys', '1'),
    }),
    ...(fee
      ? [
          field(c, 'earlyFee', {
            type: 'select',
            required: true,
            value: c.draft('earlyFee', 'charged'),
            options: [
              {
                value: 'charged',
                label: `${tr('reservation.earlyFeeCharge')} · ${money(c, c.data.quote?.earlyArrivalAmount)}`,
              },
              { value: 'waived', label: tr('reservation.earlyFeeWaive') },
            ],
          }),
          field(c, 'earlyReason', { required: true, type: 'textarea', maxLength: 500 }),
        ]
      : []),
    ...people,
  ]
}

export const deskBookingPage = createRecordPage<DeskBookingData>(
  {
    kind: 'hospitality.deskBooking',
    cache: false,
    size: 'large',
    context: {
      route: () => '/admin/hospitality/reservations/new/context',
      query: [
        'company',
        'companies',
        'branch',
        'branches',
        'lang',
        'propertyId',
        'arrival',
        'departure',
        'adults',
        'children',
        'ratePlanId',
        'page',
        'search',
        'walkIn',
      ],
    },
    title: (c) => label(c, isWalkIn(c) ? 'walkInTitle' : 'title'),
    status: (c) => <Badge label={label(c, c.data.query.ratePlanId ? 'stepTwo' : 'stepOne')} />,
    pageActions: (c) => <LinkButton label={label(c, 'back')} href={c.data.backHref} />,
    body: (c) => {
      if (!c.data.record)
        return <Notice title={label(c, 'noProperty')} message={label(c, 'noPropertyHint')} />
      if (!c.data.query.ratePlanId) {
        const results = c.data.results,
          rows = (results?.rows ?? []) as Row[]
        return (
          <Stack
            items={[
              <Surface
                title={label(c, 'stepOne')}
                body={
                  <RecordForm
                    id="desk-search-form"
                    method="get"
                    action="/admin/hospitality/reservations/new"
                    submitLabel={label(c, 'search')}
                    hidden={{
                      ...scopeFields(c),
                      search: '1',
                      ...(isWalkIn(c) ? { walkIn: '1', propertyId: String(c.data.query.propertyId) } : {}),
                    }}
                    columns={3}
                    fields={[
                      ...(isWalkIn(c)
                        ? []
                        : [
                            field(c, 'propertyId', {
                              required: true,
                              control: picker(
                                c,
                                'propertyId',
                                'hospitality_core.lookupProperties',
                                {},
                                String(c.data.query.propertyId),
                              ),
                            }),
                          ]),
                      field(c, 'arrival', {
                        type: 'date',
                        locale: c.data.locale,
                        value: String(c.data.query.arrival),
                        required: true,
                        readOnly: isWalkIn(c),
                      }),
                      field(c, 'departure', {
                        type: 'date',
                        locale: c.data.locale,
                        value: String(c.data.query.departure),
                        required: true,
                      }),
                      field(c, 'adults', {
                        type: 'number',
                        min: '1',
                        max: '8',
                        step: '1',
                        value: String(c.data.query.adults),
                        required: true,
                      }),
                      field(c, 'children', {
                        type: 'number',
                        min: '0',
                        max: '6',
                        step: '1',
                        value: String(c.data.query.children),
                        required: true,
                      }),
                    ]}
                  />
                }
              />,
              <Text variant="bodySm">
                {isWalkIn(c)
                  ? `${String(row(c.data.record.property).name)} · ${label(c, 'walkInHint')}`
                  : label(c, 'searchHint')}
              </Text>,
              results?.ok === false ? (
                <Notice
                  tone="danger"
                  title={label(c, 'searchFailed')}
                  message={((results.errors ?? []) as Row[]).map((error) => errorText(c, error)).join(' ')}
                />
              ) : null,
              results?.ok === true ? (
                <Surface
                  title={label(c, 'offers')}
                  body={
                    <Stack
                      items={[
                        <KetTable
                          id={(item) => String(item.id)}
                          rows={rows}
                          responsive="stack"
                          labels={{
                            region: label(c, 'offers'),
                            selectAll: label(c, 'choose'),
                            selectRow: label(c, 'choose'),
                            sortedAscending: label(c, 'ascending'),
                            sortedDescending: label(c, 'descending'),
                            previousPage: label(c, 'previous'),
                            nextPage: label(c, 'next'),
                            loading: c.t('recordModal.loading'),
                            loadError: c.t('recordModal.loadFailed'),
                            retry: c.t('recordModal.retry'),
                            empty: label(c, 'noOffers'),
                            emptyHint: label(c, 'noOffersHint'),
                          }}
                          columns={[
                            {
                              key: 'room',
                              label: label(c, 'roomType'),
                              cell: (item) => String(item.roomTypeName ?? '—'),
                            },
                            {
                              key: 'rate',
                              label: label(c, 'ratePlan'),
                              cell: (item) => String(item.rateName),
                            },
                            {
                              key: 'available',
                              label: label(c, 'available'),
                              cell: (item) => (item.canBook ? String(item.available) : '—'),
                            },
                            {
                              key: 'price',
                              label: label(c, 'total'),
                              cell: (item) => (item.canBook ? money(c, item.amountTotal) : '—'),
                            },
                            {
                              key: 'choose',
                              label: label(c, 'choose'),
                              cell: (item) =>
                                item.canBook ? (
                                  <LinkButton
                                    label={label(c, 'choose')}
                                    href={href(c, {
                                      ...row(results.query),
                                      search: '1',
                                      ratePlanId: item.id,
                                    })}
                                  />
                                ) : (
                                  <Text>
                                    {((item.errors ?? []) as Row[])
                                      .map((error) => errorText(c, error))
                                      .join(' ')}
                                  </Text>
                                ),
                            },
                          ]}
                        />,
                        <ActionGroup
                          actions={[
                            <LinkButton
                              label={label(c, 'previous')}
                              disabled={Number(results.page) <= 1}
                              href={href(c, {
                                ...row(results.query),
                                search: '1',
                                page: Number(results.page) - 1,
                              })}
                            />,
                            <Text>
                              {String(results.page)} / {String(results.pages)} · {String(results.total)}
                            </Text>,
                            <LinkButton
                              label={label(c, 'next')}
                              disabled={Number(results.page) >= Number(results.pages)}
                              href={href(c, {
                                ...row(results.query),
                                search: '1',
                                page: Number(results.page) + 1,
                              })}
                            />,
                          ]}
                        />,
                      ]}
                    />
                  }
                />
              ) : null,
            ]}
          />
        )
      }
      if (!c.data.can.confirm)
        return (
          <Notice
            tone="warning"
            title={label(c, 'noAuthority')}
            message={label(c, isWalkIn(c) ? 'walkInAuthorityHint' : 'bookingAuthorityHint')}
          />
        )
      const quote = c.data.quote,
        kind = guaranteeKind(c),
        mode = guestMode(c)
      const back = (
        <LinkButton label={label(c, 'changeDates')} href={href(c, { ...queryInput(c), search: '1' })} />
      )
      if (!quote)
        return (
          <Stack
            items={[
              <Notice
                tone="warning"
                title={label(c, 'offerUnavailable')}
                message={c.data.quoteErrors.map((error) => errorText(c, error)).join(' ')}
              />,
              back,
            ]}
          />
        )
      return (
        <Stack
          items={[
            <Surface
              title={label(c, 'review')}
              actions={back}
              body={
                <DescriptionList
                  items={[
                    {
                      id: 'property',
                      label: label(c, 'propertyId'),
                      value: String(row(c.data.record.property).name),
                    },
                    { id: 'type', label: label(c, 'roomType'), value: String(quote.roomTypeName) },
                    { id: 'rate', label: label(c, 'ratePlan'), value: String(quote.rateName) },
                    {
                      id: 'dates',
                      label: label(c, 'dates'),
                      value: `${c.data.query.arrival} → ${c.data.query.departure}`,
                    },
                    {
                      id: 'party',
                      label: label(c, 'party'),
                      value: `${c.data.query.adults} / ${c.data.query.children}`,
                    },
                    { id: 'total', label: label(c, 'total'), value: money(c, quote.amountTotal) },
                    {
                      id: 'policy',
                      label: label(c, 'policy'),
                      value: quote.cancellationPolicyType
                        ? c.t(`hospitality_core.record.option.${quote.cancellationPolicyType}`)
                        : label(c, 'propertyPolicy'),
                    },
                    ...(quote.cancellationPolicyType
                      ? [
                          {
                            id: 'policy-terms',
                            label: label(c, 'policyTerms'),
                            value:
                              quote.cancellationFeeRule === 'template' ||
                              quote.cancellationPolicyType === 'contract'
                                ? label(c, `policyTemplate.${quote.cancellationPolicyType}`)
                                : String(quote.cancellationPolicyType) === 'non_refundable'
                                  ? label(c, 'policyTemplate.non_refundable')
                                  : label(c, 'policyConfigured')
                                      .replace('{hours}', String(quote.freeCancellationHours ?? 0))
                                      .replace('{percent}', String(quote.penaltyPercent ?? 0)),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Notice
              tone="info"
              title={label(c, 'availabilityTitle')}
              message={label(c, 'availabilityHint')}
            />,
            c.fieldError('quote') ? (
              <Notice tone="warning" title={label(c, 'offerUnavailable')} message={c.fieldError('quote')!} />
            ) : null,
            <Surface
              title={label(c, 'stepTwo')}
              body={
                <HospitalityGuestForm
                  t={c.t}
                  kind={c.kind}
                  id="desk-confirm-form"
                  columns={3}
                  fields={[
                    field(c, 'guestMode', {
                      type: 'select',
                      control: recordStateSelectControl({
                        id: 'desk-guestMode',
                        name: 'guestMode',
                        state: 'guestMode',
                        value: mode,
                        options: ['new', 'existing'].map((value) => ({ value, label: label(c, value) })),
                      }),
                    }),
                    ...(mode === 'existing'
                      ? [
                          field(c, 'partnerId', {
                            required: true,
                            control: picker(c, 'partnerId', 'hospitality_core.lookupDeskGuests'),
                          }),
                        ]
                      : [field(c, 'guestName', { required: true, minLength: 2, maxLength: 200 })]),
                    field(c, 'phone', {
                      type: 'tel',
                      maxLength: 32,
                      help: label(
                        c,
                        isWalkIn(c)
                          ? 'walkInContactHint'
                          : mode === 'existing'
                            ? 'existingContactHint'
                            : 'contactHint',
                      ),
                    }),
                    field(c, 'email', { type: 'email', maxLength: 254 }),
                    ...(mode === 'new'
                      ? [
                          field(c, 'forceNewGuest', {
                            type: 'checkbox',
                            submitValue: 'yes',
                            checked: c.draftChecked('forceNewGuest', 'yes'),
                            help: label(c, 'duplicateHint'),
                          }),
                        ]
                      : []),
                    field(c, 'kind', {
                      type: 'select',
                      control: recordStateSelectControl({
                        id: 'desk-kind',
                        name: 'kind',
                        state: 'bookingGuarantee',
                        value: kind,
                        options: [
                          ...(isWalkIn(c) ? [] : ['none']),
                          ...(c.data.can.card ? ['card'] : []),
                          ...(c.data.can.collect ? ['collect'] : []),
                        ].map((value) => ({ value, label: label(c, value) })),
                      }),
                    }),
                    ...(kind === 'collect'
                      ? [
                          field(c, 'amount', {
                            type: 'number',
                            step: 'any',
                            min: '0',
                            required: true,
                            value: c.draft('amount', String(quote.amountTotal)),
                          }),
                          field(c, 'journalId', {
                            required: true,
                            control: picker(c, 'journalId', 'hospitality_billing.lookupDeskJournals', {
                              propertyId: c.data.query.propertyId,
                            }),
                          }),
                        ]
                      : []),
                    ...(kind !== 'none'
                      ? [
                          field(c, 'reference', {
                            required: kind === 'card',
                            maxLength: 80,
                            help: kind === 'card' ? label(c, 'referenceHint') : undefined,
                          }),
                        ]
                      : []),
                    ...(isWalkIn(c) ? walkInFields(c) : [field(c, 'expectedArrivalTime', { type: 'time' })]),
                    field(c, 'arrivalNote', { type: 'textarea', maxLength: 500, span: 'full' }),
                  ]}
                />
              }
            />,
            quote.cancellationPolicyType === 'non_refundable' ? (
              <Notice tone="warning" title={label(c, 'prepayTitle')} message={label(c, 'prepayHint')} />
            ) : null,
            <ActionGroup
              actions={[
                back,
                <Button
                  form="desk-confirm-form"
                  name="__command"
                  value="confirm"
                  type="submit"
                  label={label(c, isWalkIn(c) ? 'checkIn' : 'confirm')}
                  variant="primary"
                  disabled={c.busy || !c.data.can.confirm}
                />,
              ]}
            />,
          ]}
        />
      )
    },
    commands: {
      confirm: {
        fn: 'hospitality_billing.confirmDeskBooking',
        input: (f, c) => ({
          ...queryInput(c),
          ratePlanId: c.data.query.ratePlanId,
          quoteFingerprint: c.data.quote?.fingerprint,
          expectedAmountTotal: c.data.quote?.amountTotal,
          expectedRateVersion: Number(c.data.quote?.rateVersion),
          requestKey: c.data.commandKey,
          partnerId: guestMode(c) === 'existing' ? String(f.get('partnerId') ?? '') : undefined,
          guestName: guestMode(c) === 'new' ? String(f.get('guestName') ?? '') : undefined,
          phone: String(f.get('phone') ?? '').trim() || undefined,
          email: String(f.get('email') ?? '').trim() || undefined,
          forceNewGuest: f.get('forceNewGuest') === 'yes',
          kind: guaranteeKind(c),
          amount: guaranteeKind(c) === 'collect' ? String(f.get('amount') ?? '0') : undefined,
          journalId: guaranteeKind(c) === 'collect' ? String(f.get('journalId') ?? '') : undefined,
          reference: String(f.get('reference') ?? '') || undefined,
          expectedArrivalTime: String(f.get('expectedArrivalTime') ?? ''),
          arrivalNote: String(f.get('arrivalNote') ?? ''),
          ...(isWalkIn(c)
            ? {
                roomId: String(f.get('roomId') ?? ''),
                keys: Number(f.get('keys')),
                earlyFee: String(f.get('earlyFee') ?? ''),
                earlyReason: String(f.get('earlyReason') ?? ''),
                guests: Array.from({ length: Number(c.data.query.adults) }, (_, index) =>
                  Object.fromEntries(
                    ['fullName', 'nationality', 'type', 'number', 'birth', 'gender'].map((key) => [
                      key,
                      String(f.get(`guest-${index}-${key}`) ?? ''),
                    ]),
                  ),
                ),
              }
            : {}),
        }),
        navigate: (v, c) =>
          `/admin/hospitality/reservations/${encodeURIComponent(String(row(v).id))}?${c.data.scope}&returnTo=${encodeURIComponent(c.data.backHref)}`,
      },
    },
  },
  { path: () => '/admin/hospitality/reservations/new' },
)
