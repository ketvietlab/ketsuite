import { ActionGroup, Button, DescriptionList, Notice, Stack, Surface } from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import {
  recordIsland,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordCloseTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { ReplenishmentHelp } from './replenishment-help.tsx'

type Row = Record<string, unknown>
export type ReplenishmentData = {
  record: Row
  save: boolean
  run: boolean
  rule: boolean
  rules: Row[]
  draftId: string
  choices: Record<string, Row[]>
  supply?: Row | null
  lang?: 'vi' | 'en'
  fieldErrors?: Record<string, string>
  refusal?: string[]
}
type Context = RecordModalContext<ReplenishmentData>
const language = (c?: Context) =>
  c?.data.lang ?? (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
const value = (c: Context, key: string, fallback = '') => c.draft(key, String(c.data.record[key] ?? fallback))
const source = (c: Context) => c.state('supplySource', value(c, 'source', 'route'))
const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `replenishment-${name}`,
  name,
  label: t(c, label),
  value: value(c, name),
  error: c.fieldError(name) ?? c.data.fieldErrors?.[name],
  disabled: c.busy,
  locale: language(c),
  ...props,
})
const options = (rows: Row[]) => rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
const relation = (
  c: Context,
  name: string,
  label: string,
  config: Partial<RelationSelectConfig>,
): FieldProps => {
  const base = field(c, name, label)
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
        disabled: c.busy,
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: {
          ...labels,
          ...(name === 'vendorId' ? { choose: t(c, 'replenishment.followProduct') } : {}),
          dialogTitle: base.label,
        },
        ...config,
      },
    }),
  }
}
export function replenishmentFields(c: Context): FieldProps[] {
  const warehouseId = value(c, 'warehouseId')
  const vendorOptions = ((c.data.supply?.options ?? []) as Row[]).map((row) => ({
    value: String(row.partnerId),
    label: String(row.name),
  }))
  const fields: FieldProps[] = [
    relation(c, 'productId', 'field.product', {
      options: options(c.data.choices.products ?? []),
      required: true,
    }),
    relation(c, 'warehouseId', 'field.warehouse', {
      options: options(c.data.choices.warehouses ?? []),
      required: true,
    }),
    // Relation fields are pickers (DS "Relation pickers"), not native selects.
    relation(c, 'locationId', 'field.location', {
      required: true,
      options: options(
        (c.data.choices.locations ?? []).filter(
          (row) =>
            row.active !== false &&
            row.warehouseId === warehouseId &&
            ['internal', 'transit'].includes(String(row.usage)),
        ),
      ),
    }),
    field(c, 'trigger', 'field.trigger', {
      type: 'select',
      value: value(c, 'trigger', 'manual'),
      options: ['manual', 'auto'].map((item) => ({ value: item, label: t(c, `trigger.${item}`) })),
    }),
    field(c, 'minQuantity', 'field.minQuantity', {
      type: 'decimal',
      required: true,
      value: value(c, 'minQuantity', '0'),
    }),
    field(c, 'maxQuantity', 'field.maxQuantity', {
      type: 'decimal',
      required: true,
      value: value(c, 'maxQuantity', '0'),
    }),
    relation(c, 'replenishmentUomId', 'field.replenishmentUom', {
      options: [{ value: '', label: '—' }, ...options(c.data.choices.units ?? [])],
    }),
  ]
  if (c.data.supply?.enabled) {
    const base = field(c, 'source', 'replenishment.source')
    fields.push({
      ...base,
      control: recordStateSelectControl({
        id: base.id,
        name: 'source',
        state: 'supplySource',
        value: source(c),
        // A composition that makes goods offers manufacturing as a source (P12).
        options: ['route', 'supplier', ...(c.data.supply?.make ? ['manufacture'] : [])].map((item) => ({
          value: item,
          label: t(c, `replenishment.source.${item}`),
        })),
        disabled: c.busy,
      }),
    })
    if (source(c) === 'supplier')
      fields.push(
        relation(c, 'vendorId', 'replenishment.vendor', {
          options: [{ value: '', label: t(c, 'replenishment.followProduct') }, ...vendorOptions],
          disabled: c.busy,
          manager: {
            listFunction: 'stock.listOrderpointSuppliers',
            listInput: { includeAutomatic: true, locale: language(c) },
            listInputFields: { productId: 'productId' },
            searchInDropdown: true,
            labelField: 'name',
          },
        }),
      )
    fields.push(
      field(c, 'leadDays', 'replenishment.leadDays', {
        type: 'number',
        min: 0,
        max: 365,
        required: source(c) !== 'supplier',
        value: value(c, 'leadDays', source(c) === 'supplier' ? '' : '0'),
        help: source(c) === 'supplier' ? t(c, 'replenishment.leadHelp') : undefined,
      }),
    )
  }
  if (!c.data.supply?.enabled || source(c) === 'route')
    fields.push(
      relation(c, 'routeId', 'field.route', {
        options: [{ value: '', label: '—' }, ...options(c.data.choices.routes ?? [])],
      }),
    )
  return fields
}
function displayValue(c: Context, item: FieldProps): string {
  const name = item.name!,
    current = c.data.record[name]
  const choice = (
    {
      productId: 'products',
      warehouseId: 'warehouses',
      locationId: 'locations',
      replenishmentUomId: 'units',
      routeId: 'routes',
    } as Record<string, string>
  )[name]
  if (name === 'replenishmentUomId' && c.data.supply?.uomName) return String(c.data.supply.uomName)
  if (choice) return String(c.data.choices[choice]?.find((row) => row.id === current)?.name ?? current ?? '—')
  if (name === 'vendorId')
    return String(
      ((c.data.supply?.options ?? []) as Row[]).find((row) => row.partnerId === current)?.name ??
        current ??
        t(c, 'replenishment.followProduct'),
    )
  if (name === 'source') return t(c, `replenishment.source.${current ?? 'route'}`)
  if (name === 'trigger') return t(c, `trigger.${current}`)
  return String(current ?? '—')
}
export const replenishmentRecordDefinition: RecordModalDefinition<ReplenishmentData> = {
  kind: 'stock.replenishment',
  size: 'large',
  resetRelationsOnChange: {
    productId: ['vendorId', 'replenishmentUomId'],
    warehouseId: ['locationId'],
    // A supplier rule's empty lead time means "the supplier's days" (P50): switching source must
    // not carry the route's 0 into it.
    supplySource: ['leadDays', 'vendorId'],
  },
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/record/replenishment/${record}/context?lang=${language()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) =>
    c.creating
      ? t(c, 'replenishment.create.title')
      : String(c.data.choices.products?.find((row) => row.id === c.data.record.productId)?.name ?? c.id),
  actions: (c) => (
    <ActionGroup
      actions={[
        <Button name="screen-help" type="button" label={t(c, 'replenishment.help')} />,
        <RecordCloseTrigger>
          <Button label={c.t('recordModal.back')} />
        </RecordCloseTrigger>,
        ...(c.data.save
          ? [
              <Button
                type="submit"
                form="stock-replenishment-form"
                label={c.t('recordModal.save')}
                variant="primary"
                disabled={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  pageAside: (c) =>
    c.creating ? null : (
      <Surface
        title={t(c, 'replenishment.plan')}
        body={
          c.data.supply?.ok === false ? (
            <Notice
              tone="warning"
              title={t(c, 'replenishment.planUnavailable')}
              message={((c.data.supply.errors ?? []) as Row[])
                .map((error) => c.t(String(error.code)))
                .join(' ')}
            />
          ) : (
            <DescriptionList
              items={[
                {
                  id: 'vendor',
                  label: t(c, 'replenishment.source'),
                  value: String(
                    (c.data.supply?.selected as Row | undefined)?.name ??
                      t(
                        c,
                        `replenishment.source.${c.data.record.source === 'manufacture' ? 'manufacture' : 'route'}`,
                      ),
                  ),
                },
                {
                  id: 'days',
                  label: t(c, 'replenishment.leadDays'),
                  value: String(c.data.supply?.leadDays ?? '—'),
                },
                {
                  id: 'forecast',
                  label: t(c, 'replenishment.col.forecasted'),
                  value: String(c.data.supply?.forecasted ?? '—'),
                },
                {
                  id: 'ordered',
                  label: t(c, 'replenishment.onOrder'),
                  value: String(c.data.supply?.onOrder ?? '—'),
                },
                {
                  id: 'toOrder',
                  label: t(c, 'replenishment.col.toOrder'),
                  value: String(c.data.supply?.quantity ?? '—'),
                },
              ]}
            />
          )
        }
      />
    ),
  body: (c) => (
    <Stack
      items={[
        <ReplenishmentHelp lang={language(c)} />,
        ...(c.data.refusal?.length
          ? [
              <Notice
                tone="warning"
                title={c.t('recordModal.saveFailed')}
                message={c.data.refusal.join(' ')}
              />,
            ]
          : []),
        ...(c.presentation !== 'page' && !c.creating ? [replenishmentRecordDefinition.pageAside!(c)] : []),
        <Surface
          title={t(c, 'replenishment.settings')}
          body={
            c.data.save ? (
              <RecordModalForm
                id="stock-replenishment-form"
                kind={c.kind}
                command="save"
                fields={replenishmentFields(c)}
              />
            ) : (
              <DescriptionList
                items={replenishmentFields(c).map((item) => ({
                  id: item.name!,
                  label: item.label!,
                  value: displayValue(c, item),
                }))}
              />
            )
          }
        />,
        ...(!c.creating && c.data.run
          ? [
              <RecordActionForm kind={c.kind} command="run">
                <Button type="submit" label={t(c, 'action.run')} disabled={c.busy} />
              </RecordActionForm>,
            ]
          : []),
      ]}
    />
  ),
  commands: {
    save: {
      fn: 'stock.saveOrderpoint',
      after: 'open',
      input: (form, c) => ({
        id: c.creating ? c.data.draftId : c.id,
        ...Object.fromEntries(
          ['productId', 'warehouseId', 'locationId', 'trigger', 'minQuantity', 'maxQuantity'].map((key) => [
            key,
            String(form.get(key) ?? ''),
          ]),
        ),
        replenishmentUomId: String(form.get('replenishmentUomId') ?? '') || null,
        routeId: String(form.get('routeId') ?? '') || null,
        ...(c.data.supply?.enabled
          ? {
              source: String(form.get('source') ?? 'route'),
              vendorId: String(form.get('vendorId') ?? '') || null,
              leadDays:
                String(form.get('leadDays') ?? '').trim() === '' ? null : Number(form.get('leadDays')),
            }
          : {}),
      }),
    },
    run: {
      fn: 'stock.runOrderpoint',
      input: (_form, c) => ({ id: c.id, moveId: c.data.draftId }),
      confirm: (c) => t(c, 'modal.confirmRun'),
      navigate: (result, c) => {
        const href = `/admin/stock/replenishment/${encodeURIComponent(c.id)}?lang=${language(c)}`
        const pickingId = (result as Row | null)?.pickingId
        // A rule that makes goods opens the order it drafted.
        const made = (result as Row | null)?.href
        if (made) return `${String(made)}?lang=${language(c)}`
        return pickingId
          ? `/admin/stock/transfers/${encodeURIComponent(String(pickingId))}?lang=${language(c)}`
          : href
      },
    },
  },
}
