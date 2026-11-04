import { rulesGrid, postedRules } from './grid.tsx'
import {
  ActionGroup,
  AppSwitcherHelp,
  Button,
  DataTable,
  Notice,
  DescriptionList,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import { createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
  recordDialogHref,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'

type Row = Record<string, unknown>
export type PricelistData = {
  record: Row
  revision: string
  items: Row[]
  save: boolean
  saveItem: boolean
  ruleUnits: boolean
  can: Record<string, boolean>
  draftId: string
  lang: 'vi' | 'en'
  timezone: string
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<PricelistData>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`pricing_backend.${key}`)
const selectedRule = (c: Context) => c.data.items.find((item) => item.id === c.dialog?.params.id) ?? {}
const field = (
  c: Context,
  name: string,
  fallback: unknown = '',
  options: Partial<FieldProps> = {},
): FieldProps => ({
  id: `pricing-rule-${name}`,
  name,
  locale: c.data.lang,
  label: t(c, `field.${name}`),
  value: c.draft(name, String(selectedRule(c)[name] ?? fallback)),
  error: c.fieldError(name),
  disabled: c.busy || !c.data.saveItem,
  ...options,
})
const relation = (
  c: Context,
  name: string,
  choices: string,
  manager?: RelationSelectConfig['manager'],
  extra: Partial<RelationSelectConfig> = {},
): FieldProps => {
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
    ].map((key) => [key, c.t(`backend.relation.${key}`)]),
  )
  return {
    ...base,
    control: recordIsland('backend.relation-select', {
      id: base.id,
      config: {
        name,
        triggerId: base.id,
        ariaLabel: base.label,
        value: base.value || null,
        disabled: base.disabled,
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        options: (c.data.choices[choices] ?? []).map((row) => ({
          value: String(row.id),
          label: String(row.displayName ?? row.name),
        })),
        labels: { ...labels, dialogTitle: base.label },
        ...(manager ? { manager } : {}),
        ...extra,
      },
    }),
  }
}
const select = (c: Context, name: string, group: string, values: string[], fallback: string): FieldProps => {
  const base = field(c, name, fallback)
  return {
    ...base,
    control: recordStateSelectControl({
      id: base.id!,
      name,
      state: name,
      value: c.state(name, String(base.value)),
      disabled: base.disabled,
      options: values.map((value) => ({ value, label: t(c, `${group}.${value}`) })),
      invalid: Boolean(base.error),
      describedBy: base.error ? `${base.id}-error` : null,
    }),
  }
}
const amountFields = [
  'fixedPrice',
  'percentPrice',
  'priceDiscount',
  'priceRound',
  'priceSurcharge',
  'priceMinMargin',
  'priceMaxMargin',
]
/** A rule's amount in the pricelist's currency; the decimal string stays exact (Intl takes it as is). */
const money = (c: Context, value: unknown): string => {
  const amount = String(value ?? '')
  if (!/^-?\d+(\.\d+)?$/u.test(amount)) return amount || '—'
  const format = new Intl.NumberFormat(c.data.lang === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency: String(c.data.record.currency || 'VND'),
  }).format as unknown as (amount: string) => string
  return format(amount)
}
const ruleForm = (c: Context) => {
  const item = selectedRule(c)
  const computation = c.state('computePrice', c.draft('computePrice', String(item.computePrice ?? 'fixed')))
  const base = c.state('base', c.draft('base', String(item.base ?? 'list_price')))
  const scope = c.state('appliedOn', c.draft('appliedOn', String(item.appliedOn ?? '3_global')))
  const productId = c.draft('productId', String(item.productId ?? ''))
  const templateId = c.draft('templateId', String(item.templateId ?? ''))
  const packagingEnabled =
    c.data.ruleUnits &&
    (scope === '0_product_variant' ? Boolean(productId) : scope === '1_product' && Boolean(templateId))
  const remote = (fn: string, labelField = 'name') =>
    c.data.can[fn] ? { listFunction: fn, searchInDropdown: true, labelField } : undefined
  return (
    <RecordModalForm
      id="pricing-rule-form"
      kind={c.kind}
      command="saveItem"
      columns={2}
      fields={[
        select(
          c,
          'appliedOn',
          'appliedOn',
          ['3_global', '2_product_category', '1_product', '0_product_variant'],
          '3_global',
        ),
        ...(scope === '2_product_category' ? [relation(c, 'categoryId', 'categories')] : []),
        ...(scope === '1_product'
          ? [relation(c, 'templateId', 'templates', remote('product.listTemplates'))]
          : []),
        ...(scope === '0_product_variant'
          ? [relation(c, 'productId', 'products', remote('product.listVariants', 'displayName'))]
          : []),
        ...(['1_product', '0_product_variant'].includes(scope)
          ? [
              {
                ...relation(
                  c,
                  'uomId',
                  'units',
                  packagingEnabled
                    ? {
                        listFunction: 'pricing.listRuleUnits',
                        listInput: {
                          appliedOn: scope,
                          ...(productId ? { productId } : {}),
                          ...(templateId ? { templateId } : {}),
                        },
                        searchInDropdown: true,
                        labelField: 'name',
                      }
                    : undefined,
                  {
                    disabled: !packagingEnabled || c.busy || !c.data.saveItem,
                    options:
                      c.data.choices.units
                        ?.filter((unit) => unit.id === item.uomId)
                        .map((unit) => ({ value: String(unit.id), label: String(unit.name) })) ?? [],
                  },
                ),
                help: t(c, 'packaging.help'),
              },
            ]
          : []),
        field(c, 'minQuantity', '0', { type: 'decimal', help: t(c, 'packaging.quantityHelp') }),
        field(c, 'dateStart', '', { type: 'datetime-local', help: c.data.timezone }),
        field(c, 'dateEnd', '', { type: 'datetime-local', help: c.data.timezone }),
        select(c, 'computePrice', 'compute', ['fixed', 'percentage', 'formula'], 'fixed'),
        ...(computation !== 'fixed'
          ? [
              select(
                c,
                'base',
                'base',
                computation === 'formula'
                  ? ['list_price', 'standard_price', 'pricelist']
                  : ['list_price', 'pricelist'],
                'list_price',
              ),
            ]
          : []),
        ...(computation !== 'fixed' && base === 'pricelist' ? [relation(c, 'basePricelistId', 'lists')] : []),
        ...(computation === 'fixed'
          ? ['fixedPrice']
          : computation === 'percentage'
            ? ['percentPrice']
            : amountFields.slice(2, 5)
        ).map((name) =>
          field(c, name, '0', {
            type: 'decimal',
            ...(name === 'fixedPrice' ? { help: t(c, 'packaging.fixedHelp') } : {}),
          }),
        ),
      ]}
    />
  )
}
const settings = (c: Context) =>
  c.data.save ? (
    <RecordModalForm
      id="pricing-settings-form"
      kind={c.kind}
      command="save"
      fields={[
        {
          id: 'pricing-name',
          name: 'name',
          label: t(c, 'col.name'),
          required: true,
          value: c.draft('name', String(c.data.record.name)),
          error: c.fieldError('name'),
          disabled: c.busy,
        },
        {
          id: 'pricing-sequence',
          name: 'sequence',
          label: t(c, 'col.sequence'),
          type: 'number',
          value: c.draft('sequence', String(c.data.record.sequence)),
          error: c.fieldError('sequence'),
          disabled: c.busy,
        },
        {
          id: 'pricing-currency',
          name: 'currency',
          label: t(c, 'col.currency'),
          value: String(c.data.record.currency),
          disabled: true,
        },
        {
          id: 'pricing-active',
          name: 'active',
          label: t(c, 'col.active'),
          type: 'checkbox',
          value: c.draft('active', c.data.record.active === true ? '1' : '') === '1',
          // A pricelist another active one prices from cannot stop (D30).
          error: c.fieldError('active'),
          disabled: c.busy,
        },
      ]}
    />
  ) : (
    <DescriptionList
      items={['name', 'sequence', 'currency', 'active'].map((key) => ({
        id: key,
        label: t(c, `col.${key}`),
        value: String(c.data.record[key]),
      }))}
    />
  )
const targetName = (c: Context, row: Row) => {
  const [group, key] =
    row.appliedOn === '0_product_variant'
      ? ['products', 'productId']
      : row.appliedOn === '1_product'
        ? ['templates', 'templateId']
        : ['categories', 'categoryId']
  const found = c.data.choices[group!]?.find((entry) => entry.id === row[key!])
  return found ? String(found.displayName ?? found.name) : String(row[key!] ?? '—')
}
export const pricelistDefinition: RecordModalDefinition<PricelistData> = {
  kind: 'pricing.pricelist',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  resetRelationsOnChange: {
    appliedOn: ['productId', 'templateId', 'categoryId', 'uomId'],
    productId: ['uomId'],
    templateId: ['uomId'],
  },
  context: {
    route: (id) => `/admin/pricing/pricelists/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title: (c) => String(c.data.record.name),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        // A page, not a modal: it goes back to the list it was opened from.
        <RecordCloseTrigger>
          <Button label={t(c, 'action.back')} variant="secondary" />
        </RecordCloseTrigger>,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(c.data.save
          ? [
              <Button
                type="submit"
                form="pricing-settings-form"
                label={t(c, 'action.save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  body: (c) => (
    <Stack
      items={[
        <Surface title={t(c, 'detail.settings')} body={settings(c)} />,
        <Surface
          title={t(c, 'items.title')}
          actions={
            c.data.saveItem && !c.data.save ? (
              <RecordDialogTrigger dialog="rule">
                <Button label={t(c, 'items.add')} variant="secondary" />
              </RecordDialogTrigger>
            ) : null
          }
          body={
            c.data.saveItem && !c.data.save ? (
              <DataTable
                rows={c.data.items}
                id={(row) => String(row.id)}
                rowHref={(row) => recordDialogHref(c, 'rule', String(row.id))}
                responsive="scroll"
                columns={[
                  {
                    key: 'appliedOn',
                    label: t(c, 'field.appliedOn'),
                    cell: (row) => t(c, `appliedOn.${row.appliedOn}`),
                  },
                  { key: 'target', label: t(c, 'packaging.target'), cell: (row) => targetName(c, row) },
                  {
                    key: 'uomId',
                    label: t(c, 'field.uomId'),
                    cell: (row) =>
                      row.uomId
                        ? String(
                            c.data.choices.units?.find((unit) => unit.id === row.uomId)?.name ?? row.uomId,
                          )
                        : t(c, 'packaging.all'),
                  },
                  {
                    key: 'quantity',
                    label: t(c, 'field.minQuantity'),
                    cell: (row) => String(row.minQuantity),
                  },
                  {
                    key: 'compute',
                    label: t(c, 'field.computePrice'),
                    cell: (row) => t(c, `compute.${row.computePrice}`),
                  },
                  {
                    key: 'price',
                    label: t(c, 'field.fixedPrice'),
                    kind: 'currency',
                    cell: (row) => (row.computePrice === 'fixed' ? money(c, row.fixedPrice) : '—'),
                  },
                ]}
              />
            ) : (
              <Stack
                items={[
                  c.fieldError('items') ? (
                    <Notice tone="danger" title={t(c, 'items.title')} message={c.fieldError('items')!} />
                  ) : null,
                  recordIsland('backend.ket-grid', { id: 'pricing-rules-grid', config: rulesGrid(c) }),
                ]}
              />
            )
          }
        />,
      ]}
    />
  ),
  dialogs: {
    rule: {
      title: (c) => t(c, c.dialog?.params.id ? 'packaging.editRule' : 'items.add'),
      size: 'large',
      view: ruleForm,
      actions: (c) =>
        c.data.saveItem ? (
          <Button
            type="submit"
            form="pricing-rule-form"
            label={t(c, 'action.save')}
            variant="primary"
            loading={c.busy}
          />
        ) : undefined,
    },
  },
  commands: {
    save: {
      route: '/admin/pricing/record-command',
      input: (form, c) => ({
        id: c.id,
        name: String(form.get('name') ?? ''),
        sequence: Number(form.get('sequence') || 16),
        active: form.has('active'),
        ...(c.data.saveItem
          ? { items: JSON.stringify(postedRules(form, c.data.items)), expectedRevision: c.data.revision }
          : {}),
      }),
      after: 'reload',
    },
    saveItem: {
      route: '/admin/pricing/rule-command',
      input: (form, c) => ({
        id: c.dialog?.params.id ?? c.data.draftId,
        pricelistId: c.id,
        ...Object.fromEntries(
          [
            'appliedOn',
            'categoryId',
            'templateId',
            'productId',
            'uomId',
            'base',
            'basePricelistId',
            'computePrice',
            'dateStart',
            'dateEnd',
          ].map((key) => [key, String(form.get(key) ?? '') || null]),
        ),
        ...Object.fromEntries(
          ['minQuantity', ...amountFields].map((key) => [key, String(form.get(key) ?? '') || '0']),
        ),
      }),
      after: 'reload',
    },
  },
}
export const pricelistPage = createRecordPage(pricelistDefinition, {
  path: (id) => `/admin/pricing/pricelists/${encodeURIComponent(id)}`,
})
