import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
  DescriptionList,
  Field,
  FormGrid,
  LinkButton,
  Notice,
  Section,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig, RelationSelectLabels } from '@ketvietlab/design-system'
import {
  createRecordPage,
  recordIsland,
  type RecordModalDefinition,
  type RecordModalContext,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordModalForm,
  RecordActionForm,
  RecordDialogTrigger,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { PromotionHelp } from '../screens/help.tsx'
type Row = Record<string, unknown>
export type Data = {
  record: Row
  references: Record<string, Array<{ value: string; label: string }>>
  summary: { reward: string; usage: string } | null
  save: boolean
  lifecycle: boolean
  generate: boolean
  cardHref: string | null
  lang: 'vi' | 'en'
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t('sale_promotion_backend.' + key)
const chosen = (c: Context, key: string, fallback: string) =>
  c.state(key, c.draft(key, String(c.data.record[key] ?? fallback)))
const kind = (c: Context) => chosen(c, 'programType', 'promotion')
const formId = 'sale-promotion-form'
function field(c: Context, name: string, extra: Partial<FieldProps> = {}): FieldProps {
  return {
    id: 'promotion-' + name,
    name,
    locale: c.data.lang,
    label: t(c, name),
    value: c.draft(name, String(c.data.record[name] ?? '')),
    disabled: c.busy || !c.data.save,
    error: c.fieldError(name),
    ...extra,
  }
}
function select(
  c: Context,
  name: string,
  options: string[],
  fallback: string,
  extra: Partial<FieldProps> = {},
): FieldProps {
  const base = field(c, name, extra)
  return {
    ...base,
    control: recordStateSelectControl({
      id: base.id!,
      name,
      state: name,
      value: chosen(c, name, fallback),
      options: options.map((value) => ({ value, label: t(c, value) })),
      disabled: Boolean(base.disabled),
      invalid: Boolean(base.error),
      describedBy:
        [base.help ? base.id + '-help' : '', base.error ? base.id + '-error' : '']
          .filter(Boolean)
          .join(' ') || null,
    }),
  }
}
function relation(c: Context, name: string, ref: string, multiple = true, gift = false): FieldProps {
  const saved = c.data.record[name],
    value = c.draft(name, Array.isArray(saved) ? saved.join(',') : String(saved ?? ''))
  const base = field(c, name)
  const labels = Object.fromEntries(
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
    ].map((key) => [key, c.t('backend.relation.' + key)]),
  ) as Omit<RelationSelectLabels, 'dialogTitle'>
  const config: RelationSelectConfig = {
    name,
    ariaLabel: base.label,
    triggerId: base.id,
    multiple,
    ...(multiple ? { values: String(value).split(',').filter(Boolean) } : { value: String(value) || null }),
    disabled: Boolean(base.disabled),
    invalid: Boolean(base.error),
    options: c.data.references[name] ?? [],
    labels: { ...labels, dialogTitle: String(base.label) },
    manager: {
      listFunction: 'loyalty_sale.searchProgramReferences',
      listInput: { kind: ref, ...(gift ? { gift: true } : {}) },
      searchInDropdown: true,
      limit: 25,
    },
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id!, config }) }
}
function sections(c: Context) {
  const type = kind(c),
    reward = type === 'buy_x_get_y' ? 'product' : chosen(c, 'rewardType', 'discount')
  const mode = chosen(c, 'discountMode', 'percent'),
    scope = chosen(c, 'discountApplicability', 'order')
  const fieldSection = (title: string, fields: FieldProps[]) => (
    <Section
      title={t(c, title)}
      body={<FormGrid columns={2} items={fields.map((item) => <Field {...item} />)} />}
    />
  )
  return (
    <Stack
      divided
      items={[
        fieldSection('program', [
          field(c, 'name', { required: true, maxLength: 80 }),
          select(
            c,
            'programType',
            ['promotion', 'promo_code', 'buy_x_get_y', 'coupons', 'next_order_coupons', 'loyalty'],
            'promotion',
            { disabled: c.busy || !c.data.save || Number(c.data.record.cards) > 0, help: t(c, 'kindHelp') },
          ),
          ...(type === 'promo_code'
            ? [field(c, 'code', { required: true, maxLength: 30, help: t(c, 'codeHelp') })]
            : []),
          field(c, 'startDate', { type: 'date' }),
          field(c, 'endDate', { type: 'date' }),
          ...(['promotion', 'promo_code', 'buy_x_get_y'].includes(type)
            ? [field(c, 'maxUsage', { type: 'number', min: 1, max: 999999, help: t(c, 'usageHelp') })]
            : []),
          relation(c, 'pricelistIds', 'pricelist'),
        ]),
        fieldSection('conditions', [
          field(c, 'minimumQuantity', {
            type: 'number',
            min: 0,
            label: t(c, type === 'buy_x_get_y' ? 'buyQuantity' : 'minimumQuantity'),
          }),
          field(c, 'minimumAmount', { inputMode: 'decimal' }),
          select(c, 'taxMode', ['excl', 'incl'], 'excl'),
          relation(c, 'productIds', 'product'),
          relation(c, 'categoryIds', 'category'),
          relation(c, 'tagIds', 'tag'),
        ]),
        ...(type === 'loyalty'
          ? [
              fieldSection('earning', [
                select(c, 'pointMode', ['money', 'order', 'unit'], 'money'),
                field(c, 'pointAmount', { inputMode: 'decimal', required: true }),
                ...(chosen(c, 'pointMode', 'money') === 'money'
                  ? [
                      field(c, 'pointStep', {
                        inputMode: 'decimal',
                        required: true,
                        help: t(c, 'pointStepHelp'),
                      }),
                    ]
                  : []),
              ]),
            ]
          : []),
        fieldSection('reward', [
          ...(type === 'loyalty'
            ? [field(c, 'requiredPoints', { inputMode: 'decimal', required: true })]
            : []),
          ...(type !== 'buy_x_get_y' ? [select(c, 'rewardType', ['discount', 'product'], 'discount')] : []),
          ...(reward === 'product'
            ? [
                relation(c, 'rewardProductId', 'product', false, true),
                field(c, 'rewardProductQuantity', { inputMode: 'decimal', required: true }),
              ]
            : [
                select(c, 'discountMode', ['percent', 'per_order'], 'percent'),
                field(c, 'discount', { inputMode: 'decimal', required: true }),
                select(c, 'discountApplicability', ['order', 'cheapest', 'specific'], 'order'),
                ...(scope === 'specific' ? [relation(c, 'rewardProductIds', 'product')] : []),
                ...(mode === 'percent' ? [field(c, 'discountMaximum', { inputMode: 'decimal' })] : []),
              ]),
        ]),
      ]}
    />
  )
}
const arrays = ['pricelistIds', 'productIds', 'categoryIds', 'tagIds', 'rewardProductIds']
export function programInput(form: FormData, c: Context) {
  const values: Row = {
    programType: kind(c),
    rewardType: kind(c) === 'buy_x_get_y' ? 'product' : chosen(c, 'rewardType', 'discount'),
  }
  for (const key of [
    'name',
    'code',
    'startDate',
    'endDate',
    'maxUsage',
    'minimumQuantity',
    'minimumAmount',
    'taxMode',
    'pointMode',
    'pointAmount',
    'pointStep',
    'requiredPoints',
    'rewardProductId',
    'rewardProductQuantity',
    'discountMode',
    'discount',
    'discountApplicability',
    'discountMaximum',
  ]) {
    const value = form.get(key)
    if (value !== null) values[key] = String(value)
  }
  for (const key of arrays)
    values[key] = String(form.get(key) ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  return { ...(c.creating ? {} : { id: c.id, expectedRevision: Number(c.data.record.revision) }), values }
}
export const promotionDefinition: RecordModalDefinition<Data> = {
  kind: 'sale.promotion',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/sales/promotions/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'create') : String(c.data.record.name)),
  // The saved type, as the mock shows it under the name; an archived program says so.
  status: (c) =>
    c.creating ? null : (
      <>
        <Badge label={t(c, String(c.data.record.programType))} tone="info" />
        {c.data.record.active ? null : <Badge label={t(c, 'archived')} tone="neutral" />}
      </>
    ),
  // Two columns of fields, as the mock lays a program out.
  size: 'large',
  pageActions: (c) => (
    <ActionGroup
      actions={[
        ...(!c.creating && c.data.lifecycle
          ? [
              <RecordActionForm kind={c.kind} command="lifecycle">
                <Button
                  type="submit"
                  label={t(c, c.data.record.active ? 'archive' : 'restore')}
                  disabled={c.busy || c.recordChanged}
                />
              </RecordActionForm>,
            ]
          : []),
        ...(!c.creating && c.data.generate && c.data.record.active && c.data.record.programType === 'coupons'
          ? [
              <RecordDialogTrigger dialog="coupons">
                <Button label={t(c, 'generate')} />
              </RecordDialogTrigger>,
            ]
          : []),
        <PromotionHelp lang={c.data.lang} />,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.close')} />
        </RecordCloseTrigger>,
        ...(c.data.save
          ? [<Button type="submit" form={formId} variant="primary" label={t(c, 'save')} disabled={c.busy} />]
          : []),
      ]}
    />
  ),
  body: (c) => (
    <Stack
      items={[
        ...(c.data.summary
          ? [
              <Surface
                body={
                  <DescriptionList
                    columns={2}
                    items={[
                      { id: 'reward', label: t(c, 'reward'), value: c.data.summary.reward },
                      { id: 'usage', label: t(c, 'usage'), value: c.data.summary.usage },
                    ]}
                  />
                }
              />,
            ]
          : []),
        <RecordModalForm
          kind={c.kind}
          id={formId}
          command="save"
          fields={[]}
          body={<Surface body={sections(c)} />}
          actions={[]}
        />,
        ...(!c.creating &&
        c.data.cardHref &&
        ['coupons', 'next_order_coupons', 'loyalty'].includes(String(c.data.record.programType))
          ? [
              <Section
                title={t(c, 'cards') + ' (' + String(c.data.record.cards) + ')'}
                body={<LinkButton href={c.data.cardHref} label={t(c, 'viewCards')} />}
              />,
            ]
          : []),
      ]}
    />
  ),
  dialogs: {
    coupons: {
      title: (c) => t(c, 'generate'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="coupons"
          fields={
            c.recordChanged
              ? []
              : [
                  field(c, 'count', {
                    type: 'number',
                    min: 1,
                    max: 100,
                    required: true,
                    value: c.draft('count', '1'),
                  }),
                  relation(c, 'partnerId', 'partner', false),
                  field(c, 'expiresOn', { type: 'date' }),
                ]
          }
          body={c.recordChanged ? <Notice tone="warning" title={t(c, 'saveFirst')} message="" /> : null}
          actions={[
            <Button
              type="submit"
              variant="primary"
              label={t(c, 'generate')}
              disabled={c.busy || c.recordChanged || !c.data.generate}
            />,
          ]}
        />
      ),
    },
  },
  commands: {
    save: { fn: 'loyalty_sale.saveProgram', input: programInput, after: 'open' },
    lifecycle: {
      fn: 'loyalty_sale.setProgramActive',
      input: (_form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        active: !c.data.record.active,
      }),
      confirm: (c) => (c.data.record.active ? t(c, 'archiveConfirm') : null),
      after: 'reload',
    },
    coupons: {
      fn: 'loyalty_sale.generateCoupons',
      input: (form, c) => ({
        id: c.id,
        expectedRevision: Number(c.data.record.revision),
        count: Number(form.get('count')),
        ...(form.get('partnerId') ? { partnerId: String(form.get('partnerId')) } : {}),
        ...(form.get('expiresOn') ? { expiresOn: String(form.get('expiresOn')) } : {}),
      }),
      after: 'reload',
    },
  },
}
export const promotionPage = createRecordPage(promotionDefinition, {
  path: (id) => `/admin/sales/promotions/${encodeURIComponent(id)}`,
})
