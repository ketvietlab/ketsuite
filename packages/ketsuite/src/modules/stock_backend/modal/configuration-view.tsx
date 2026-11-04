import { replenishmentRecordDefinition } from '../screens/replenishment-record.tsx'
import { lotAvailable, lotDateFields } from '../../stock/lot-policy.ts'
import { LotHelp } from '../screens/lot-help.tsx'
import { LocationHelp } from '../screens/location-help.tsx'
import { WarehouseHelp } from '../screens/warehouse-help.tsx'
import { CarrierHelp } from '../delivery/help.tsx'
import {
  ActionGroup,
  Button,
  Link,
  LinkButton,
  DescriptionList,
  DataTable,
  Notice,
  Section,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordModal, createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordModalForm,
  RecordDialogTrigger,
  RecordCloseTrigger,
  RecordActionForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { stockConfigurations } from './configuration.ts'
import { SCRAP_REASONS } from '../../stock/scrap-reasons.ts'
import type { ConfigurationField } from './configuration.ts'
type Row = Record<string, unknown>
type Data = {
  record: Row
  save: boolean
  rule: boolean
  run: boolean
  rules: Row[]
  quants?: Row[]
  history?: Row[]
  productHref?: string | null
  /** K37: whether the viewer may scrap what a warehouse holds of this lot. */
  scrapLot?: boolean
  /** K32: the lot's finished lines, newest first, and the rail's figures; absent for a reader of neither. */
  trace?: Row[]
  figures?: Record<'received' | 'onHand' | 'held' | 'delivered' | 'customers', number>
  /** P11: what production made of the lot; absent for a reader of production or without it. */
  production?: { checks: Row[]; rows: Row[]; customers: number }
  /** K28/K32: what the lot is fit for today. */
  condition?: string
  draftId: string
  /** K10: the name a warehouse gave this record, when the modal shows it translated. */
  storedName?: string | null
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<Data>
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, label: string) => c.t(`stock_backend.${label}`)
/** K37: the warehouses whose stock location holds some of the lot free of other transfers, and how much. */
const scrapHoldings = (c: Context) =>
  (c.data.choices.warehouses ?? []).flatMap((warehouse) => {
    const held = (c.data.quants ?? [])
      .filter((row) => row.locationId === `${String(warehouse.id)}:stock`)
      .reduce((sum, row) => sum + Math.max(0, Number(row.quantity) - Number(row.reservedQuantity ?? 0)), 0)
    return held > 0 ? [{ id: String(warehouse.id), name: String(warehouse.name), held }] : []
  })
/** The reason a lot's state suggests: past its expiry or removal date, quarantined, or else damaged. */
const suggestedReason = (lot: Row) => {
  const past = (field: string) => Boolean(lot[field]) && new Date(String(lot[field])).getTime() <= Date.now()
  return past('expirationDate') || past('removalDate')
    ? 'expired'
    : lot.quarantined === true
      ? 'failedTest'
      : 'damaged'
}
/** What a scrap order took from the lot or gave back, as its history row tells it. */
const scrapHistory = (c: Context, row: Row) => {
  if (!['scrap', 'scrapUndo'].includes(String(row.reason))) return null
  const after = (row.after ?? {}) as Row
  return [
    after.scrap,
    after.quantity,
    after.reason ? t(c, `scrap.reason.${String(after.reason)}`) : null,
    after.note,
  ]
    .filter((part) => part != null && part !== '')
    .map(String)
    .join(' · ')
}
/** K37: a count adjustment names its count, the book before and what was counted. */
const countHistory = (row: Row) => {
  if (row.reason !== 'countAdjustment') return null
  const after = (row.after ?? {}) as Row
  return [
    after.count,
    `${String((row.before as Row)?.quantity ?? '—')} → ${String(after.quantity ?? '—')}`,
    after.reason,
  ]
    .filter((part) => part != null && part !== '')
    .map(String)
    .join(' · ')
}
const lotValue = (c: Context, field: string, value: unknown) => {
  if (value == null || value === '') return '—'
  if (field === 'quarantined') return t(c, `lot.quarantined.${String(value)}`)
  if (field === 'active') return t(c, `lot.status.${value ? 'active' : 'archived'}`)
  if ((lotDateFields as readonly string[]).includes(field))
    return new Intl.DateTimeFormat(lang(), { timeZone: 'UTC' }).format(new Date(String(value)))
  return String(value)
}
const ruleFields: ConfigurationField[] = [
  { name: 'name', label: 'stockRoute.rule.col.name', required: true },
  {
    name: 'action',
    label: 'field.ruleAction',
    choices: ['pull', 'push', 'pull_push'],
    choiceLabel: 'ruleAction',
    defaultValue: 'pull',
    required: true,
  },
  { name: 'locationSrcId', label: 'field.sourceLocation', lookup: 'locations' },
  { name: 'locationDestId', label: 'field.destinationLocation', lookup: 'locations', required: true },
  { name: 'pickingTypeId', label: 'field.operationType', lookup: 'pickingTypes', required: true },
  { name: 'sequence', label: 'field.sequence', type: 'number', defaultValue: '20' },
  {
    name: 'procureMethod',
    label: 'field.procureMethod',
    choices: ['make_to_stock', 'make_to_order', 'mts_else_mto'],
    choiceLabel: 'procureMethod',
    defaultValue: 'make_to_stock',
  },
]
/** A field of several values: the design system's relation picker over the field's lookup. */
const manyField = (c: Context, field: ConfigurationField, record: Row): FieldProps => {
  const id = `${c.kind}-${c.dialog?.name ?? 'record'}-${field.name}`
  const label = t(c, field.label)
  const error = c.fieldError(field.name)
  const saved = ((record[field.name] as unknown[] | undefined) ?? []).map(String)
  return {
    id,
    name: field.name,
    label,
    span: field.span,
    ...(field.help ? { help: t(c, field.help) } : {}),
    error,
    control: recordIsland('backend.relation-select', {
      id,
      config: {
        name: field.name,
        triggerId: id,
        ariaLabel: label,
        multiple: true,
        value: null,
        // The picker keeps who is chosen and posts them as one comma-joined field. Its props hold the saved
        // values, as a sales team's members do: a draft in them would change on every pick and remount the
        // picker, closing it and dropping focus. A refused field shows again with what was picked.
        values: (error ? c.draft(field.name, saved.join(',')) : saved.join(',')).split(',').filter(Boolean),
        options: (c.data.choices[field.lookup!] ?? []).map((row) => ({
          value: String(row.id),
          label: String(row.name),
        })),
        invalid: Boolean(error),
        describedBy: error ? `${id}-error` : undefined,
        disabled: c.busy,
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
              'retry',
              'clear',
              'chosen',
            ].map((word) => [word, c.t(`backend.relation.${word}`)]),
          ),
          dialogTitle: label,
        },
      },
    }),
  }
}
/** The names a several-value field holds, for a reader who may not change them. */
const manyValue = (c: Context, field: ConfigurationField, record: Row) =>
  ((record[field.name] as unknown[] | undefined) ?? [])
    .map((id) => String(c.data.choices[field.lookup!]?.find((row) => row.id === id)?.name ?? ''))
    .filter(Boolean)
    .join(', ') || '—'
const formFields = (c: Context, fields: ConfigurationField[], record: Row): FieldProps[] =>
  fields.map((field) =>
    field.multiple
      ? manyField(c, field, record)
      : {
          id: `${c.kind}-${c.dialog?.name ?? 'record'}-${field.name}`,
          name: field.name,
          label: t(c, field.label),
          type: field.type,
          locale: lang(),
          required: field.required,
          span: field.span,
          ...(field.help ? { help: t(c, field.help) } : {}),
          value: c.draft(
            field.name,
            field.type === 'date'
              ? String(record[field.name] ?? '').slice(0, 10)
              : String(record[field.name] ?? field.defaultValue ?? ''),
          ),
          error: c.fieldError(field.name),
          disabled: c.busy || (field.fixed === true && !c.creating),
          ...(field.choices
            ? {
                type: 'select' as const,
                options: field.choices.map((value) => ({
                  value,
                  label: t(c, `${field.choiceLabel}.${value}`),
                })),
              }
            : {}),
          ...(field.lookup
            ? {
                type: 'select' as const,
                options: [
                  { value: '', label: '—' },
                  ...(c.data.choices[field.lookup] ?? [])
                    .filter((row) => field.name !== 'parentId' || row.id !== c.id)
                    .map((row) => ({ value: String(row.id), label: String(row.name) })),
                ],
              }
            : {}),
        },
  )
const values = (form: FormData, fields: ConfigurationField[]) =>
  Object.fromEntries(
    fields.flatMap<[string, unknown]>((field) => {
      const value = String(form.get(field.name) ?? '')
      if (field.multiple) return [[field.name, value.split(',').filter(Boolean)]]
      if (field.type === 'date')
        return [[field.name, value ? new Date(`${value}T00:00:00Z`).toISOString() : null]]
      if (field.name === 'quarantined' || field.name === 'isDefault') return [[field.name, value === 'true']]
      if (field.type === 'number')
        return value
          ? [[field.name, Number(value)]]
          : field.emptyValue === undefined
            ? []
            : [[field.name, field.emptyValue]]
      return value || field.required
        ? [[field.name, value]]
        : field.lookup
          ? [[field.name, null]]
          : field.type === 'textarea' || !field.type
            ? [[field.name, '']]
            : []
    }),
  )
const selectedRule = (c: Context) => c.data.rules.find((row) => row.id === c.dialog?.params.id)
/** A civil day, `YYYY-MM-DD`, in the reader's language, as the lot's own date fields print it. */
const dayText = (value: unknown) => {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ''))
  return match
    ? new Intl.DateTimeFormat(lang(), { timeZone: 'UTC' }).format(new Date(`${match[0]}T00:00:00Z`))
    : ''
}

/** K32: a quarantined, expired or soon expiring lot says so above everything else. */
const lotNotice = (c: Context) => {
  const condition = c.data.condition
  if (condition === 'quarantined')
    return [
      <Notice
        tone="danger"
        title={t(c, 'lot.notice.quarantined')}
        message={String(c.data.record.reason ?? '') || t(c, 'lot.notice.quarantinedHint')}
      />,
    ]
  if (condition === 'expired' || condition === 'expiring')
    return [
      <Notice
        tone={condition === 'expired' ? 'danger' : 'warning'}
        title={t(c, `lot.notice.${condition}`)}
        message={`${t(c, 'lot.field.expirationDate')}: ${dayText(c.data.record.expirationDate)}`}
      />,
    ]
  return []
}

/** K32: where the lot went, from the count or receipt that brought it in to the customers it reached. */
const lotTrace = (c: Context) => (
  <Surface
    title={t(c, 'lot.trace.title')}
    body={
      <DataTable
        emptyTitle={t(c, 'lot.trace.empty')}
        emptyMessage={t(c, 'lot.trace.hint')}
        rows={c.data.trace ?? []}
        id={(row) => String(row.id)}
        responsive="scroll"
        columns={[
          { key: 'date', label: t(c, 'history.col.date'), cell: (row) => dayText(row.date) },
          {
            key: 'document',
            label: t(c, 'history.col.picking'),
            cell: (row) => <Link label={String(row.pickingName)} href={String(row.pickingHref)} />,
          },
          { key: 'from', label: t(c, 'history.col.from'), cell: (row) => String(row.from) },
          { key: 'to', label: t(c, 'history.col.to'), cell: (row) => String(row.to) },
          {
            key: 'quantity',
            label: t(c, 'history.col.quantity'),
            kind: 'number',
            cell: (row) => `${String(row.quantity)}${row.uomName ? ` ${String(row.uomName)}` : ''}`,
          },
          {
            key: 'kind',
            label: t(c, 'history.col.kind'),
            cell: (row) => t(c, `analysis.kind.${String(row.kind)}`),
          },
          { key: 'partner', label: t(c, 'lot.trace.partner'), cell: (row) => String(row.partner ?? '—') },
          {
            key: 'origin',
            label: t(c, 'lot.trace.origin'),
            cell: (row) =>
              row.originHref ? (
                <Link label={String(row.origin)} href={String(row.originHref)} />
              ) : (
                String(row.origin ?? '—')
              ),
          },
        ]}
      />
    }
  />
)

/** P11: the lot through production: its quality check, the orders around it and who received it. */
const lotProduction = (c: Context, production: NonNullable<Data['production']>) => (
  <Surface
    title={t(c, 'lot.production.title')}
    body={
      <Stack
        items={[
          ...production.checks.map((check) => (
            <Notice
              tone={check.state === 'passed' ? 'positive' : check.state === 'failed' ? 'danger' : 'warning'}
              title={`${t(c, 'lot.production.quality')} · ${String(check.document)}`}
              message={c.t('stock_backend.lot.production.qualityFacts', {
                state: t(c, `lot.production.quality.${String(check.state)}`),
                ph: String(check.ph ?? '—'),
                sensory: check.sensory ? t(c, `lot.production.sensory.${String(check.sensory)}`) : '—',
              })}
            />
          )),
          ...(production.customers
            ? [
                <Text>
                  {c.t('stock_backend.lot.production.recall', { count: String(production.customers) })}
                </Text>,
              ]
            : []),
          <DataTable
            emptyTitle={t(c, 'lot.production.empty')}
            emptyMessage={t(c, 'lot.production.hint')}
            rows={production.rows}
            id={(row) => String(row.id)}
            responsive="scroll"
            columns={[
              {
                key: 'relation',
                label: t(c, 'lot.production.relation'),
                cell: (row) => t(c, `lot.production.${String(row.relation)}`),
              },
              {
                key: 'document',
                label: t(c, 'lot.production.document'),
                cell: (row) =>
                  row.documentHref ? (
                    <Link label={String(row.document)} href={String(row.documentHref)} />
                  ) : (
                    String(row.document ?? '—')
                  ),
              },
              {
                key: 'lot',
                label: t(c, 'lot.production.lot'),
                cell: (row) =>
                  row.lotHref ? <Link label={String(row.lot)} href={String(row.lotHref)} /> : '—',
              },
              {
                key: 'quantity',
                label: t(c, 'lot.production.quantity'),
                kind: 'number',
                cell: (row) => (row.quantity == null ? '—' : String(row.quantity)),
              },
              {
                key: 'partner',
                label: t(c, 'lot.production.partner'),
                cell: (row) => String(row.partner ?? '—'),
              },
            ]}
          />,
        ]}
      />
    }
  />
)

/** K32: the lot at a glance, beside its page. */
const lotFigures = (c: Context) => (
  <Surface
    title={t(c, 'lot.figures.title')}
    body={
      <DescriptionList
        items={(['received', 'onHand', 'held', 'delivered', 'customers'] as const).map((key) => ({
          id: key,
          label: t(c, `lot.figures.${key}`),
          value: String(c.data.figures?.[key] ?? 0),
        }))}
      />
    }
  />
)

export const stockConfigurationDefinition = (key: string): RecordModalDefinition<Data> => {
  if (key === 'replenishment') return replenishmentRecordDefinition
  const config = stockConfigurations[key]!
  const editForm = (c: Context) => {
    const form = (
      <RecordModalForm
        columns={key === 'location' || (c.creating && key === 'route') ? 1 : 2}
        id={key === 'lot' ? 'stock-lot-form' : undefined}
        kind={c.kind}
        command="save"
        fields={formFields(c, config.fields, c.data.record)}
        actions={
          key === 'lot'
            ? []
            : [<Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />]
        }
      />
    )
    return key === 'lot' ? <Surface title={t(c, 'lot.information.title')} body={form} /> : form
  }
  return {
    kind: config.kind,
    size: (c) =>
      key === 'location'
        ? 'small'
        : key === 'route'
          ? c.creating
            ? 'small'
            : 'large'
          : key === 'lot'
            ? 'large'
            : 'default',
    labels: () => USER_RECORD_MODAL_LABELS[lang()],
    actions:
      key === 'lot'
        ? (c) => (
            <ActionGroup
              actions={[
                <Button
                  name="screen-help"
                  type="button"
                  label={lang() === 'vi' ? 'Hướng dẫn' : 'Help'}
                  variant="secondary"
                />,
                <RecordCloseTrigger>
                  <Button label={c.t('recordModal.back')} variant="secondary" />
                </RecordCloseTrigger>,
                ...(c.data.productHref
                  ? [
                      <LinkButton
                        label={t(c, 'lot.action.openProduct')}
                        href={c.data.productHref}
                        variant="secondary"
                      />,
                    ]
                  : []),
                ...(c.data.scrapLot && scrapHoldings(c).length
                  ? [
                      <RecordDialogTrigger dialog="scrap">
                        <Button label={t(c, 'lot.scrap')} variant="secondary" disabled={c.busy} />
                      </RecordDialogTrigger>,
                    ]
                  : []),
                ...(c.data.save
                  ? [
                      <Button
                        type="submit"
                        form="stock-lot-form"
                        label={c.t('recordModal.save')}
                        variant="primary"
                        disabled={c.busy}
                      />,
                    ]
                  : []),
              ]}
            />
          )
        : key === 'carrier'
          ? (c) => (
              <ActionGroup
                actions={[
                  <Button
                    name="screen-help"
                    type="button"
                    label={lang() === 'vi' ? 'Hướng dẫn' : 'Help'}
                    variant="secondary"
                  />,
                  ...(c.data.save && !c.creating
                    ? [
                        <RecordActionForm
                          kind={c.kind}
                          command={c.data.record.state === 'archived' ? 'activate' : 'archive'}
                        >
                          <Button
                            type="submit"
                            label={t(
                              c,
                              c.data.record.state === 'archived' ? 'carrier.activate' : 'carrier.archive',
                            )}
                            variant="secondary"
                            disabled={
                              c.busy ||
                              (c.data.record.isDefault === true && c.data.record.state !== 'archived')
                            }
                          />
                        </RecordActionForm>,
                      ]
                    : []),
                ]}
              />
            )
          : key === 'warehouse' || key === 'location'
            ? () => (
                <ActionGroup
                  actions={[
                    <Button
                      name="screen-help"
                      type="button"
                      label={lang() === 'vi' ? 'Hướng dẫn' : 'Help'}
                      variant="secondary"
                    />,
                  ]}
                />
              )
            : undefined,
    context: {
      route: (id, creating) => {
        const record = creating ? 'new' : encodeURIComponent(id)
        return `/admin/stock/record/${key}/${record}/context?lang=${lang()}`
      },
      query: ['company', 'branch'],
    },
    title: (c) =>
      c.creating
        ? t(c, config.title)
        : String(
            c.data.record.name ??
              c.data.choices.products?.find((row) => row.id === c.data.record.productId)?.name ??
              c.id,
          ),
    body: (c) => (
      <Stack
        items={[
          ...(key === 'lot' ? [<LotHelp lang={lang()} />] : []),
          ...(key === 'lot' && !c.creating ? lotNotice(c) : []),
          ...(key === 'warehouse' ? [<WarehouseHelp lang={lang()} />] : []),
          ...(key === 'location' ? [<LocationHelp lang={lang()} />] : []),
          ...(key === 'carrier' ? [<CarrierHelp lang={lang()} />] : []),
          ...(key === 'carrier' && c.data.record.state === 'archived'
            ? [
                <Notice
                  tone="warning"
                  title={t(c, 'carrier.archivedTitle')}
                  message={t(c, 'carrier.archivedMessage')}
                />,
              ]
            : []),
          c.data.save ? (
            editForm(c)
          ) : (
            <DescriptionList
              items={config.fields.map((field) => ({
                id: field.name,
                label: t(c, field.label),
                value:
                  key === 'lot' && field.type === 'date'
                    ? lotValue(c, field.name, c.data.record[field.name])
                    : field.choices
                      ? t(c, `${field.choiceLabel}.${c.data.record[field.name] ?? field.defaultValue}`)
                      : field.multiple
                        ? manyValue(c, field, c.data.record)
                        : String(
                            (field.lookup
                              ? c.data.choices[field.lookup]?.find(
                                  (row) => row.id === c.data.record[field.name],
                                )?.name
                              : null) ??
                              c.data.record[field.name] ??
                              '—',
                          ),
              }))}
            />
          ),
          ...(key === 'lot' && !c.creating
            ? [
                <Surface
                  title={t(c, 'lot.history.title')}
                  body={
                    <DataTable
                      emptyTitle={t(c, 'lot.history.empty')}
                      emptyMessage={t(c, 'lot.history.emptyHint')}
                      rows={c.data.history ?? []}
                      id={(row: Row) => String(row.id)}
                      columns={[
                        {
                          key: 'at',
                          label: t(c, 'lot.history.at'),
                          cell: (row: Row) => new Date(String(row.at)).toLocaleString(lang()),
                        },
                        {
                          key: 'actorId',
                          label: t(c, 'lot.history.actor'),
                          cell: (row: Row) => String(row.actorId ?? '—'),
                        },
                        {
                          key: 'reason',
                          label: t(c, 'lot.field.reason'),
                          cell: (row: Row) =>
                            [
                              'dates',
                              'scrap',
                              'scrapUndo',
                              'countAdjustment',
                              'qualityPending',
                              'qualityPassed',
                            ].includes(String(row.reason))
                              ? t(c, `lot.history.${String(row.reason)}`)
                              : String(row.reason ?? ''),
                        },
                        {
                          key: 'changes',
                          label: t(c, 'lot.history.changes'),
                          cell: (row: Row) =>
                            scrapHistory(c, row) ??
                            countHistory(row) ??
                            Object.entries((row.after ?? {}) as Row)
                              .filter(([field, value]) => value !== (row.before as Row)?.[field])
                              .map(
                                ([field, value]) =>
                                  `${t(c, field === 'active' ? 'lot.list.col.status' : `lot.field.${field}`)}: ${lotValue(c, field, value)}`,
                              )
                              .join(' · '),
                        },
                      ]}
                    />
                  }
                />,
              ]
            : []),
          ...(key === 'lot' && !c.creating
            ? [
                <Surface
                  title={t(c, 'lot.inventory.title')}
                  body={
                    <DataTable
                      emptyTitle={t(c, 'lot.empty')}
                      emptyMessage={t(c, 'lot.inventory.hint')}
                      rows={c.data.quants ?? []}
                      id={(row) => String(row.id)}
                      responsive="scroll"
                      columns={[
                        {
                          key: 'location',
                          label: t(c, 'lot.col.location'),
                          cell: (row) =>
                            String(
                              c.data.choices.locations?.find((location) => location.id === row.locationId)
                                ?.name ?? row.locationId,
                            ),
                        },
                        {
                          key: 'quantity',
                          label: t(c, 'lot.col.onHand'),
                          cell: (row) => String(row.quantity),
                        },
                        {
                          key: 'reserved',
                          label: t(c, 'lot.col.reserved'),
                          cell: (row) => String(row.reservedQuantity),
                        },
                        {
                          key: 'available',
                          label: t(c, 'lot.col.available'),
                          cell: (row) =>
                            String(
                              lotAvailable(c.data.record)
                                ? Math.max(0, Number(row.quantity) - Number(row.reservedQuantity))
                                : 0,
                            ),
                        },
                      ]}
                    />
                  }
                />,
              ]
            : []),
          ...(key === 'lot' && !c.creating && c.data.trace ? [lotTrace(c)] : []),
          ...(key === 'lot' && !c.creating && c.data.production ? [lotProduction(c, c.data.production)] : []),
          ...(key === 'route' && !c.creating
            ? [
                <Section
                  title={t(c, 'stockRoute.rule.col.name')}
                  actions={
                    c.data.rule ? (
                      <RecordDialogTrigger dialog="rule">
                        <Button label={t(c, 'stockRoute.rule.create.title')} />
                      </RecordDialogTrigger>
                    ) : null
                  }
                  body={
                    <DataTable
                      rows={c.data.rules}
                      id={(row) => String(row.id)}
                      responsive="scroll"
                      columns={[
                        {
                          key: 'name',
                          label: t(c, 'stockRoute.rule.col.name'),
                          cell: (row) => String(row.name),
                        },
                        {
                          key: 'action',
                          label: t(c, 'field.ruleAction'),
                          cell: (row) => t(c, `ruleAction.${row.action}`),
                        },
                        {
                          key: 'sequence',
                          label: t(c, 'field.sequence'),
                          cell: (row) => String(row.sequence),
                        },
                        {
                          key: 'edit',
                          label: t(c, 'action.save'),
                          cell: (row) =>
                            c.data.rule ? (
                              <RecordDialogTrigger dialog="rule" id={String(row.id)}>
                                <Button label={t(c, 'modal.edit')} variant="tertiary" />
                              </RecordDialogTrigger>
                            ) : (
                              ''
                            ),
                        },
                      ]}
                    />
                  }
                />,
              ]
            : []),
          ...(key === 'replenishment' && !c.creating && c.data.run
            ? [
                <RecordActionForm kind={c.kind} command="run">
                  <Button type="submit" label={t(c, 'action.run')} disabled={c.busy} />
                </RecordActionForm>,
              ]
            : []),
        ]}
      />
    ),
    ...(key === 'lot'
      ? {
          pageAside: (c: Context) => (c.creating || !c.data.figures ? undefined : lotFigures(c)),
          pageAsideLabel: (c: Context) => t(c, 'lot.figures.title'),
          pageAsideWhenStacked: 'after' as const,
        }
      : {}),
    dialogs: {
      scrap: {
        title: (c) => t(c, 'lot.scrapTitle'),
        view: (c) => {
          const base = (name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
            id: `lot-scrap-${name}`,
            name,
            label: t(c, label),
            value: c.draft(`scrap.${name}`, String(props.value ?? '')),
            error: c.fieldError(name),
            disabled: c.busy,
            ...props,
          })
          const holdings = scrapHoldings(c)
          return (
            <RecordModalForm
              kind={c.kind}
              command="scrap"
              columns={1}
              body={
                <Notice tone="warning" title={t(c, 'lot.scrapEffect')} message={t(c, 'lot.scrapMessage')} />
              }
              fields={[
                (() => {
                  const field = base('warehouseId', 'lot.scrapWarehouse', {
                    required: true,
                    value: String(holdings[0]?.id ?? ''),
                  })
                  return {
                    ...field,
                    control: recordIsland('backend.relation-select', {
                      id: field.id,
                      config: {
                        name: 'warehouseId',
                        triggerId: field.id,
                        ariaLabel: field.label,
                        value: field.value || null,
                        required: true,
                        disabled: c.busy,
                        invalid: Boolean(field.error),
                        describedBy: field.error ? `${field.id}-error` : undefined,
                        options: holdings.map((row) => ({
                          value: row.id,
                          label: `${row.name} · ${row.held}`,
                        })),
                        labels: {
                          ...Object.fromEntries(
                            ['choose', 'search', 'noRecords', 'close', 'select', 'clear', 'chosen'].map(
                              (key) => [key, c.t(`backend.relation.${key}`)],
                            ),
                          ),
                          dialogTitle: field.label,
                        },
                      },
                    }),
                  }
                })(),
                base('quantity', 'lot.scrapQuantity', {
                  type: 'decimal',
                  help: t(c, 'lot.scrapQuantityHelp'),
                }),
                base('reason', 'scrap.reason', {
                  type: 'select',
                  required: true,
                  value: suggestedReason(c.data.record),
                  options: SCRAP_REASONS.map((value) => ({ value, label: t(c, `scrap.reason.${value}`) })),
                }),
                base('note', 'lot.scrapNote', {
                  type: 'textarea',
                  required: true,
                  help: t(c, 'lot.scrapNoteHelp'),
                }),
              ]}
              actions={[
                <Button type="submit" label={t(c, 'lot.scrap')} variant="primary" disabled={c.busy} />,
              ]}
            />
          )
        },
      },
      rule: {
        title: (c) => t(c, 'stockRoute.rule.col.name'),
        view: (c) => (
          <RecordModalForm
            kind={c.kind}
            command="rule"
            fields={formFields(c, ruleFields, selectedRule(c) ?? {})}
            actions={[
              <Button type="submit" label={c.t('recordModal.save')} variant="primary" disabled={c.busy} />,
            ]}
          />
        ),
      },
    },
    commands: {
      scrap: {
        fn: 'stock.scrapLot',
        after: 'reload',
        input: (form, c) => ({
          id: c.data.draftId,
          lotId: c.id,
          warehouseId: String(form.get('warehouseId') ?? ''),
          quantity: String(form.get('quantity') ?? ''),
          reason: String(form.get('reason') ?? ''),
          note: String(form.get('note') ?? ''),
        }),
      },
      save: {
        fn: config.save,
        after: 'open',
        input: (form, c) => ({
          id: c.creating ? c.data.draftId : c.id,
          ...values(
            form,
            config.fields.filter((field) => c.creating || field.fixed !== true),
          ),
          // K10: a warehouse-made name left as the reader saw it keeps the stored one, so it still reads in
          // each reader's language.
          ...(c.data.storedName && String(form.get('name') ?? '') === String(c.data.record.name)
            ? { name: c.data.storedName }
            : {}),
          ...(key === 'lot' && c.data.record.revisionId
            ? { expectedRevisionId: c.data.record.revisionId }
            : {}),
        }),
      },
      rule: {
        fn: 'stock.saveRule',
        after: 'reload',
        input: (form, c) => ({
          id: selectedRule(c)?.id ?? c.data.draftId,
          routeId: c.id,
          ...values(form, ruleFields),
        }),
      },
      archive: {
        fn: 'stock.archiveCarrier',
        after: 'reload',
        input: (_form, c) => ({ id: c.id }),
        confirm: (c) => t(c, 'carrier.confirmArchive'),
      },
      activate: {
        fn: 'stock.activateCarrier',
        after: 'reload',
        input: (_form, c) => ({ id: c.id }),
        confirm: (c) => t(c, 'carrier.confirmActivate'),
      },
      run: {
        fn: 'stock.runOrderpoint',
        after: 'reload',
        input: (_form, c) => ({ id: c.id, moveId: c.data.draftId }),
        confirm: (c) => t(c, 'modal.confirmRun'),
      },
    },
  }
}
export const warehouseModal = createRecordModal(stockConfigurationDefinition('warehouse'))
export const locationModal = createRecordModal(stockConfigurationDefinition('location'))
export const pickingTypeModal = createRecordModal(stockConfigurationDefinition('picking-type'))
export const lotModal = createRecordModal(stockConfigurationDefinition('lot'))
export const stockRouteModal = createRecordModal(stockConfigurationDefinition('route'))
export const replenishmentModal = createRecordModal(stockConfigurationDefinition('replenishment'))
export const carrierModal = createRecordModal(stockConfigurationDefinition('carrier'))

export const lotPage = createRecordPage(stockConfigurationDefinition('lot'), {
  path: (id) => `/admin/stock/lots/${encodeURIComponent(id)}`,
})

export const replenishmentPage = createRecordPage(replenishmentRecordDefinition, {
  path: (id) => `/admin/stock/replenishment/${encodeURIComponent(id)}`,
})
