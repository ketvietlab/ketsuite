import type { FieldProps } from '@ketvietlab/design-system'
import { randomUUID } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import {
  ActionGroup,
  Badge,
  Dialog,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import { formatMoney } from '../../../ui/index.ts'
type Item = Record<string, unknown>

export async function loadReservationGuaranteeWorkspace(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  reservationId: string,
  errors: readonly string[] = [],
  draft: Record<string, string | undefined> = {},
) {
  if (!(await ctx.allows('hospitality_billing.getReservationGuaranteeContext', url, req))) return null
  const data = (await ctx.call(
    'hospitality_billing.getReservationGuaranteeContext',
    { reservationId },
    url,
    req,
  )) as Item
  const booking = data.booking as Item,
    payments = data.payments as Item[],
    journals = data.journals as Item[]
  const _ = ctx.translate(ctx.localeOf(url, req)),
    t = (key: string) => _(`hospitality_billing.guarantee.${key}`)
  const [take, save] = await Promise.all([
    ctx.allows('hospitality_billing.takeReservationGuarantee', url, req),
    ctx.allows('hospitality_billing.setReservationGuarantee', url, req),
  ])
  const editable = ['draft', 'confirmed'].includes(String(booking.state)),
    kind = String(booking.guaranteeKind),
    key = draft.requestKey || randomUUID()
  const base = new URL(url)
  base.searchParams.delete('action')
  base.searchParams.delete('finance')
  base.searchParams.delete('status')
  const href = (step?: string) => {
    const next = new URL(base)
    if (step) next.searchParams.set('finance', step)
    return next.pathname + next.search
  }
  const hidden = { reservationId, expectedVersion: String(booking.version), requestKey: key },
    value = (name: string, fallback = '') => draft[name] ?? fallback
  const invalid = new Set((draft._invalid ?? '').split(','))
  const field = (props: FieldProps): FieldProps => ({
    ...props,
    error: invalid.has(props.name ?? '') ? (errors[0] ?? '') : undefined,
  })
  const step = url.searchParams.get('finance') ?? url.searchParams.get('action'),
    dialogs = []
  if (editable && take && (kind === 'none' || !data.valid) && step === 'deposit')
    dialogs.push(
      <Dialog
        id="reservation-guarantee-step"
        title={`${t('takeDeposit')} · ${booking.code}`}
        closeHref={href()}
        closeLabel={t('back')}
        body={
          <Stack
            items={[
              journals.length ? null : (
                <Notice tone="warning" title={t('noJournal')} message={t('noJournalHint')} />
              ),
              <RecordForm
                action={href('deposit')}
                method="post"
                submitLabel={t('takeDeposit')}
                submitDisabled={!journals.length}
                hidden={{ ...hidden, operation: 'take-deposit' }}
                errors={errors}
                fields={[
                  field({
                    id: 'booking-deposit-amount',
                    name: 'amount',
                    type: 'number',
                    label: t('amount'),
                    value: value('amount'),
                    min: '1',
                    max: String(booking.amountTotal),
                    step: 'any',
                    required: true,
                  }),
                  field({
                    id: 'booking-deposit-journal',
                    name: 'journalId',
                    type: 'select',
                    label: t('journal'),
                    value: value('journalId'),
                    required: true,
                    options: [
                      { value: '', label: t('chooseJournal') },
                      ...journals.map((row) => ({
                        value: String(row.id),
                        label: `${row.code} · ${row.name}`,
                      })),
                    ],
                  }),
                  field({
                    id: 'booking-deposit-reference',
                    name: 'reference',
                    label: t('reference'),
                    value: value('reference'),
                    maxLength: 120,
                  }),
                  field({
                    id: 'booking-deposit-note',
                    name: 'memo',
                    type: 'textarea',
                    label: t('note'),
                    value: value('memo'),
                    maxLength: 2000,
                  }),
                ]}
              />,
            ]}
          />
        }
      />,
    )
  if (editable && save && step === 'guarantee')
    dialogs.push(
      <Dialog
        id="reservation-guarantee-step"
        title={`${t('record')} · ${booking.code}`}
        closeHref={href()}
        closeLabel={t('back')}
        body={
          <Stack
            items={[
              <Notice tone="info" title={t('evidence')} message={t('evidenceHint')} />,
              <RecordForm
                action={href('guarantee')}
                method="post"
                submitLabel={t('record')}
                hidden={{ ...hidden, operation: 'set-guarantee' }}
                errors={errors}
                fields={[
                  field({
                    id: 'booking-guarantee-kind',
                    name: 'kind',
                    type: 'select',
                    label: t('kind'),
                    value: value('kind', kind === 'none' ? 'card' : kind),
                    options: ['card', 'deposit', 'prepaid', 'agent'].map((value) => ({
                      value,
                      label: t(value),
                    })),
                  }),
                  field({
                    id: 'booking-guarantee-amount',
                    name: 'amount',
                    type: 'number',
                    label: t('amount'),
                    value: value('amount', String(booking.guaranteeAmount ?? '')),
                    min: '1',
                    max: String(booking.amountTotal),
                    step: 'any',
                  }),
                  field({
                    id: 'booking-guarantee-payment',
                    name: 'paymentId',
                    type: 'select',
                    label: t('paymentEvidence'),
                    value: value(
                      'paymentId',
                      ['deposit', 'prepaid'].includes(kind) ? String(booking.guaranteeReference ?? '') : '',
                    ),
                    options: [
                      { value: '', label: t('chooseEvidence') },
                      ...payments.map((row) => ({
                        value: String(row.id),
                        label: `${row.reference} · ${formatMoney(_, String(row.available))}`,
                      })),
                    ],
                  }),
                  field({
                    id: 'booking-guarantee-reference',
                    name: 'reference',
                    label: t('authorization'),
                    value: value(
                      'reference',
                      ['card', 'agent'].includes(kind) ? String(booking.guaranteeReference ?? '') : '',
                    ),
                    help: t('authorizationHint'),
                    maxLength: 80,
                  }),
                ]}
              />,
            ]}
          />
        }
      />,
    )
  return (
    <Stack
      items={[
        <Section
          title={t('title')}
          actions={
            <ActionGroup
              actions={
                editable
                  ? [
                      take && (kind === 'none' || !data.valid) ? (
                        <LinkButton
                          href={href('deposit')}
                          label={t('takeDeposit')}
                          variant={kind === 'none' ? 'primary' : 'secondary'}
                        />
                      ) : null,
                      save ? <LinkButton href={href('guarantee')} label={t('record')} /> : null,
                    ]
                  : []
              }
            />
          }
          body={
            <Stack
              items={[
                <Badge
                  label={t(kind)}
                  tone={kind === 'none' ? 'warning' : data.valid || !editable ? 'positive' : 'danger'}
                />,
                booking.guaranteeAmount ? formatMoney(_, String(booking.guaranteeAmount)) : null,
                editable && kind !== 'none' && !data.valid ? (
                  <Notice tone="warning" title={t('invalid')} message={t('invalidHint')} />
                ) : null,
                url.searchParams.get('status') === 'guaranteed' ? (
                  <Notice tone="positive" title={t('saved')} message={t('savedHint')} />
                ) : null,
              ]}
            />
          }
        />,
        ...dialogs,
      ]}
    />
  )
}
