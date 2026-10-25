import { ActivityTimeline, Badge, Button, Notice, Section, Stack } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { HOSPITALITY_RECORD_LABELS } from '../../hospitality_core/records/config.ts'
export type ChargeRuleModalData = {
  record: Record<string, unknown>
  canSave: boolean
  choices: Record<string, Array<Record<string, unknown>>>
  chargeTypes: string[]
  commandKey: string
  locale: 'vi' | 'en'
}
type Data = ChargeRuleModalData
type Context = RecordModalContext<Data>
const t = (c: Context, key: string) => c.t(`hospitality_billing.ruleRecord.${key}`)
// Set up once the saved rule answers the tax question: a tax, or no tax with its reason (`chargeRuleConfigured`).
const configured = (record: Record<string, unknown>) =>
  record.taxExempt === true ? String(record.taxExemptReason ?? '').trim().length >= 3 : Boolean(record.taxId)
const exempt = (c: Context) =>
  c.state('taxMode', c.data.record.taxExempt === true ? 'exempt' : 'taxed') === 'exempt'
const requestQuery = () =>
  typeof location === 'undefined'
    ? ''
    : new URLSearchParams(
        [...new URL(location.href).searchParams].filter(([key]) =>
          ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
        ),
      ).toString()
// Type, income account, tax treatment, then the one tax question it asks: the tax (and where it posts), or the
// reason for no tax (HOS-DEC-034).
const fields = (c: Context): FieldProps[] => {
  const disabled = c.busy || !c.data.canSave
  const relation = (name: 'incomeAccountId' | 'taxId' | 'taxAccountId'): FieldProps => {
    const fn = name === 'taxId' ? 'lookupChargeRuleTaxes' : 'lookupChargeRuleAccounts'
    const labels = Object.fromEntries(
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
        'save',
        'cancel',
        'remove',
        'confirmRemove',
        'retry',
        'clear',
        'chosen',
      ].map((key) => [key, c.t(`hospitality_core.collection.lookup.${key}`)]),
    )
    const label = t(c, name)
    return {
      id: `${c.kind}-${name}`,
      name,
      label,
      required: name === 'taxId',
      error: c.fieldError(name),
      control: recordIsland('backend.relation-select', {
        id: `${c.kind}-${name}`,
        config: {
          name,
          ariaLabel: label,
          value: c.draft(name, String(c.data.record[name] ?? '')) || null,
          disabled,
          required: name === 'taxId',
          labels,
          options: (c.data.choices[name] ?? []).map((row) => ({
            value: String(row.id),
            label: String(row.name),
          })),
          manager: {
            listFunction: `hospitality_billing.${fn}`,
            searchInDropdown: true,
            requestQuery: requestQuery(),
            listInput: name === 'taxAccountId' ? { kind: 'tax' } : {},
            limit: 80,
            resolveParam: 'id',
            idField: 'id',
            labelField: 'name',
          },
        },
      }),
    }
  }
  return [
    {
      id: `${c.kind}-type`,
      name: 'chargeType',
      label: t(c, 'chargeType'),
      type: 'select',
      required: true,
      value: c.draft('chargeType', String(c.data.record.chargeType ?? '')),
      disabled: disabled || !c.creating,
      options: [
        { value: '', label: t(c, 'choose') },
        ...c.data.chargeTypes.map((value) => ({
          value,
          label: c.t(`hospitality_billing.chargeType.${value}`),
        })),
      ],
      error: c.fieldError('chargeType'),
    },
    relation('incomeAccountId'),
    {
      id: `${c.kind}-tax-mode`,
      name: 'taxMode',
      label: t(c, 'taxMode'),
      type: 'select',
      control: recordStateSelectControl({
        id: `${c.kind}-tax-mode`,
        name: 'taxMode',
        state: 'taxMode',
        value: exempt(c) ? 'exempt' : 'taxed',
        disabled,
        options: ['taxed', 'exempt'].map((value) => ({ value, label: t(c, value) })),
      }),
    },
    ...(exempt(c)
      ? [
          {
            id: `${c.kind}-reason`,
            name: 'taxExemptReason',
            label: t(c, 'taxExemptReason'),
            type: 'textarea',
            required: true,
            span: 'full',
            value: c.draft('taxExemptReason', String(c.data.record.taxExemptReason ?? '')),
            disabled,
            error: c.fieldError('taxExemptReason'),
          } satisfies FieldProps,
        ]
      : [relation('taxId'), relation('taxAccountId')]),
  ]
}
const input = (form: FormData, c: Context) => ({
  chargeType: c.creating ? String(form.get('chargeType') ?? '') : c.data.record.chargeType,
  incomeAccountId: String(form.get('incomeAccountId') ?? '') || null,
  taxId: exempt(c) ? null : String(form.get('taxId') ?? '') || null,
  taxAccountId: exempt(c) ? null : String(form.get('taxAccountId') ?? '') || null,
  taxExempt: exempt(c),
  taxExemptReason: exempt(c) ? String(form.get('taxExemptReason') ?? '') : null,
  expectedVersion: c.data.record.version ?? 0,
  requestKey: c.data.commandKey,
})
export const chargeRuleModalDefinition: RecordModalDefinition<Data> = {
  kind: 'hospitality.billingRule',
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/hospitality/billing/rules/${record}/record-context`
    },
    query: ['company', 'companies', 'branch', 'branches', 'lang'],
  },
  cache: false,
  labels: () =>
    HOSPITALITY_RECORD_LABELS[
      typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
    ],
  title: (c) =>
    c.creating ? t(c, 'create') : c.t(`hospitality_billing.chargeType.${c.data.record.chargeType}`),
  status: (c) =>
    c.creating ? undefined : (
      <Badge
        tone={configured(c.data.record) ? 'positive' : 'warning'}
        label={c.t(
          `hospitality_billing.collection.state.${configured(c.data.record) ? 'ready' : 'incomplete'}`,
        )}
      />
    ),
  body: (c) => {
    const history = Array.isArray(c.data.record.history)
      ? (c.data.record.history as Array<Record<string, unknown>>)
      : []
    return Stack({
      items: [
        Section({
          title: t(c, 'section'),
          body: <RecordModalForm kind={c.kind} id={`${c.kind}-form`} fields={fields(c)} />,
        }),
        <Notice tone="info" title={t(c, 'hint')} message={t(c, 'hintBody')} />,
        // A rule decides the money on an invoice, so it keeps who changed it and to what.
        history.length
          ? Section({
              title: t(c, 'history'),
              body: ActivityTimeline({
                label: t(c, 'history'),
                items: history.map((row, i) => {
                  const after = (row.after ?? {}) as Record<string, unknown>
                  return {
                    id: String(i),
                    actor: String(row.actorName ?? t(c, row.actorId ? 'staff' : 'system')),
                    action: t(c, row.before ? 'changed' : 'created'),
                    detail: [t(c, after.taxExempt === true ? 'exempt' : 'taxed'), after.taxExemptReason]
                      .filter(Boolean)
                      .join(' · '),
                    datetime: String(row.occurredAt),
                    timeLabel: new Intl.DateTimeFormat(c.data.locale, {
                      timeZone: 'Asia/Ho_Chi_Minh',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(String(row.occurredAt))),
                  }
                }),
              }),
            })
          : null,
      ],
    })
  },
  actions: (c) => (
    <>
      {RecordCloseTrigger({ children: Button({ label: t(c, 'cancel'), variant: 'secondary' }) })}
      {c.data.canSave ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value={c.creating ? 'create' : 'save'}
          label={t(c, 'save')}
          variant="primary"
          disabled={c.busy}
        />
      ) : null}
    </>
  ),
  commands: {
    create: {
      fn: 'hospitality_billing.saveChargeRule',
      input,
      after: 'open',
      created: (value) => String((value as Record<string, unknown>).chargeType),
    },
    save: { fn: 'hospitality_billing.saveChargeRule', input, after: 'close' },
  },
}
export const chargeRuleModal = createRecordModal<Data>(chargeRuleModalDefinition)
