import { Dialog, LinkButton, RecordForm as AdjustmentForm } from '@ketvietlab/design-system'
import { dateKeyIn } from '../calendar.ts'
import { FormScreenFrame } from './page-frame.tsx'
import {
  badge,
  chargeDescription,
  CHARGE_TYPES,
  dataTable,
  dateTime,
  DefinitionList,
  emptyState,
  folioChargeColumns,
  folioDetailFeedback,
  type FolioRow,
  folioStayColumns,
  formatMoney,
  type Frame,
  icon,
  linkButton,
  Notice,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  type TemplateResult,
  type Translator,
  workflowTone,
} from './shared.tsx'

const MANUAL_CHARGE_TYPES = CHARGE_TYPES.filter((type) => type !== 'minibar')

export const folioDetailScreen = (
  _: Translator,
  folio: FolioRow,
  locale: string,
  timezone: string,
  frame: Frame,
  chargeId: string,
  status?: string | null,
  errors: readonly string[] = [],
  financial?: TemplateResult | null,
  currentHref?: string,
  correction?: { allowed: boolean; businessDate: string; draft: Record<string, string | undefined> },
): TemplateResult => {
  const stays = folio.stays ?? []
  const charges = folio.charges ?? []
  const activeCharges = charges.filter((charge) => charge.state === 'active')
  const staysById = new Map(stays.map((stay) => [stay.id, stay]))
  const locked = (charge: (typeof charges)[number]) =>
    !!correction?.businessDate &&
    String(charge.serviceDate ?? dateKeyIn(new Date(charge.occurredAt), timezone)) < correction.businessDate
  const voidableCharges = activeCharges.filter((charge) => !locked(charge))
  const adjustable = activeCharges.filter((charge) => !charge.adjustsChargeId && locked(charge))
  const adjustmentHref = (id: string) => {
    const next = new URL(
      currentHref ?? `/admin/hospitality/folios/${encodeURIComponent(folio.id)}`,
      'http://local.invalid',
    )
    next.searchParams.delete('finance')
    next.searchParams.set('action', 'adjust')
    next.searchParams.set('charge', id)
    return next.pathname + next.search
  }
  const current = new URL(currentHref ?? '/', 'http://local.invalid'),
    selected = adjustable.find((charge) => charge.id === current.searchParams.get('charge'))
  const t = (key: string) => _(`hospitality_core.folio.adjust.${key}`)
  const adjustment =
    correction?.allowed &&
    folio.state === 'open' &&
    current.searchParams.get('action') === 'adjust' &&
    selected ? (
      <Dialog
        id="folio-adjustment-step"
        title={t('title')}
        closeHref={(() => {
          const url = new URL(current)
          url.searchParams.delete('action')
          url.searchParams.delete('charge')
          return url.pathname + url.search
        })()}
        closeLabel={t('back')}
        body={
          <AdjustmentForm
            action={adjustmentHref(selected.id)}
            method="post"
            submitLabel={t('save')}
            errors={errors}
            hidden={{
              operation: 'adjust-charge',
              chargeId: selected.id,
              expectedVersion: String(folio.version),
              requestKey: correction.draft.requestKey ?? chargeId,
            }}
            fields={[
              {
                id: 'folio-adjustment-amount',
                name: 'amount',
                type: 'number',
                label: t('amount'),
                value: correction.draft.amount ?? '',
                step: 'any',
                required: true,
                help: t('amountHint'),
                error: correction.draft._invalid?.split(',').includes('amount') ? errors[0] : undefined,
              },
              {
                id: 'folio-adjustment-reason',
                name: 'reason',
                type: 'textarea',
                label: t('reason'),
                value: correction.draft.reason ?? '',
                required: true,
                minLength: 3,
                maxLength: 2000,
                error: correction.draft._invalid?.split(',').includes('reason') ? errors[0] : undefined,
              },
            ]}
          />
        }
      />
    ) : null
  const guest = folio.partner?.name ?? folio.partnerId
  const action =
    currentHref ??
    `/admin/hospitality/folios/${encodeURIComponent(folio.id)}?lang=${encodeURIComponent(locale)}`

  return (
    <FormScreenFrame
      translator={_}
      title={_('hospitality_core.folio.detail.title', { code: folio.code })}
      frame={frame}
      body={stack([
        folioDetailFeedback(_, status, errors),
        adjustment,
        !financial && (
          <Notice
            title={_('hospitality_core.folio.notice.operational')}
            message={_('hospitality_core.folio.notice.operationalHint')}
            tone="info"
          />
        ),
        <RecordWorkspace
          kicker={_('hospitality_core.folio.detail.kicker')}
          title={folio.code}
          subtitle={guest}
          imageFallback={icon('receipt-text')}
          badges={[
            badge(_(`hospitality_core.folioState.${folio.state}`), workflowTone(folio.state), folio.state),
          ]}
          summary={[
            {
              id: 'amount',
              label: _('hospitality_core.folio.metric.activeTotal'),
              value: formatMoney(_, folio.amountTotal),
            },
            {
              id: 'charges',
              label: _('hospitality_core.folio.metric.activeCharges'),
              value: activeCharges.length,
            },
            {
              id: 'stays',
              label: _('hospitality_core.col.stays'),
              value: stays.length,
            },
          ]}
          navigation={linkButton({
            label: _('hospitality_core.folio.action.back'),
            href: `/admin/hospitality/folios?property=${encodeURIComponent(folio.propertyId)}&lang=${encodeURIComponent(locale)}`,
            variant: 'tertiary',
            icon: 'chevron-left',
          })}
          body={stack([
            financial,
            <Section
              title={_('hospitality_core.folio.section.information')}
              description={_('hospitality_core.folio.section.informationHint')}
              body={
                <DefinitionList
                  title={folio.code}
                  items={[
                    {
                      key: 'guest',
                      term: _('hospitality_core.col.guest'),
                      value: guest,
                    },
                    {
                      key: 'opened',
                      term: _('hospitality_core.folio.field.openedAt'),
                      value: dateTime(folio.openedAt, locale, timezone),
                    },
                    ...(folio.closedAt
                      ? [
                          {
                            key: 'closed',
                            term: _('hospitality_core.folio.field.closedAt'),
                            value: dateTime(folio.closedAt, locale, timezone),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />,
            <Section
              title={_('hospitality_core.folio.section.charges')}
              description={_('hospitality_core.folio.section.chargesHint')}
              body={stack([
                charges.length
                  ? dataTable(_, {
                      columns: [
                        ...folioChargeColumns(_, locale, timezone, staysById),
                        ...(correction?.allowed && folio.state === 'open' && adjustable.length
                          ? [
                              {
                                key: 'adjust',
                                label: t('title'),
                                cell: (charge: (typeof charges)[number]) =>
                                  adjustable.some((row) => row.id === charge.id) ? (
                                    <LinkButton href={adjustmentHref(charge.id)} label={t('title')} />
                                  ) : (
                                    ''
                                  ),
                              },
                            ]
                          : []),
                      ],
                      rows: charges,
                      id: (charge) => charge.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.charges'),
                      _('hospitality_core.folio.empty.chargesHint'),
                    ),
                folio.state === 'open' ? (
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.postCharge')}
                    submitVariant="secondary"
                    hidden={{
                      operation: 'post-charge',
                      id: chargeId,
                      lang: locale,
                      expectedVersion: String(folio.version ?? 0),
                      requestKey: chargeId,
                    }}
                    fields={[
                      {
                        name: 'stayId',
                        label: _('hospitality_core.folio.charge.stay'),
                        type: 'select',
                        options: [
                          { value: '', label: _('hospitality_core.folio.value.noStay') },
                          ...stays.map((stay) => ({ value: stay.id, label: stay.code })),
                        ],
                      },
                      {
                        name: 'description',
                        label: _('hospitality_core.folio.charge.description'),
                        required: true,
                      },
                      {
                        name: 'type',
                        label: _('hospitality_core.folio.charge.type'),
                        type: 'select',
                        required: true,
                        value: 'service',
                        options: MANUAL_CHARGE_TYPES.map((type) => ({
                          value: type,
                          label: _(`hospitality_core.charge.${type}`),
                        })),
                      },
                      {
                        name: 'quantity',
                        label: _('hospitality_core.folio.charge.quantity'),
                        type: 'decimal',
                        value: '1',
                        step: '0.01',
                        required: true,
                      },
                      {
                        name: 'unitPrice',
                        label: _('hospitality_core.folio.charge.unitPrice'),
                        type: 'decimal',
                        step: '0.01',
                        required: true,
                      },
                    ]}
                  />
                ) : null,
              ])}
            />,
            voidableCharges.length && folio.state === 'open' ? (
              <Section
                title={_('hospitality_core.folio.section.correction')}
                description={_('hospitality_core.folio.section.correctionHint')}
                body={
                  <RecordForm
                    action={action}
                    method="post"
                    submit={_('hospitality_core.folio.action.voidCharge')}
                    submitVariant="destructive"
                    hidden={{
                      operation: 'void-charge',
                      lang: locale,
                      expectedVersion: String(folio.version ?? 0),
                      requestKey: chargeId,
                    }}
                    fields={[
                      {
                        name: 'chargeId',
                        label: _('hospitality_core.folio.field.charge'),
                        type: 'select',
                        required: true,
                        options: voidableCharges.map((charge) => ({
                          value: charge.id,
                          label: `${chargeDescription(_, charge)} · ${formatMoney(_, charge.amount)}`,
                        })),
                      },
                      {
                        name: 'reason',
                        label: _('hospitality_core.folio.field.voidReason'),
                        type: 'textarea',
                        required: true,
                        help: _('hospitality_core.folio.field.voidReasonHint'),
                      },
                    ]}
                  />
                }
              />
            ) : null,
            <Section
              title={_('hospitality_core.folio.section.stays')}
              description={_('hospitality_core.folio.section.staysHint')}
              body={
                stays.length
                  ? dataTable(_, {
                      columns: folioStayColumns(_, locale, timezone),
                      rows: stays,
                      id: (stay) => stay.id,
                    })
                  : emptyState(
                      _('hospitality_core.folio.empty.stays'),
                      _('hospitality_core.folio.empty.staysHint'),
                    )
              }
            />,
          ])}
        />,
      ])}
    />
  )
}
