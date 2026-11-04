import {
  ActionGroup,
  Badge,
  Button,
  DescriptionList,
  Link,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, RelationSelectConfig } from '@ketvietlab/design-system'
import {
  createRecordModal,
  recordIsland,
  type RecordModalContext,
  type RecordModalDefinition,
} from '../../../ui/client/record-modal.tsx'
import {
  RecordActionForm,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { ScrapHelp } from '../screens/scrap-help.tsx'
import { SCRAP_REASONS } from '../../stock/scrap-reasons.ts'

type Row = Record<string, unknown>
type Data = {
  record: Row
  lang: 'vi' | 'en'
  permissions: Record<string, boolean>
  draftId: string
  source: { name: string; products: string[] } | null
  links: Record<'source' | 'operation' | 'undo' | 'replenishment', string | null>
  /** Present only for a viewer who may read stock value (K25). */
  value: string | null
  choices: Record<'warehouses' | 'products' | 'lots', Row[]>
}
type Context = RecordModalContext<Data>

const language = () =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
const draft = (c: Context) => c.creating || c.data.record.state === 'draft'
const editable = (c: Context) => draft(c) && c.data.permissions.saveScrap === true
const nameOf = (rows: Row[] | undefined, id: unknown) =>
  String(rows?.find((row) => row.id === id)?.name ?? (id ? String(id) : '—'))

const field = (c: Context, name: string, label: string, props: Partial<FieldProps> = {}): FieldProps => ({
  id: `scrap-${name}`,
  name,
  label: t(c, label),
  value: c.draft(name, String(c.data.record[name] ?? '')),
  error: c.fieldError(name),
  disabled: c.busy,
  locale: c.data.lang,
  ...props,
})

/** A relation picker of the design system, filled from what the context loaded. */
const relation = (
  c: Context,
  name: string,
  label: string,
  rows: Row[],
  config: Partial<RelationSelectConfig> = {},
): FieldProps => {
  const base = field(c, name, label, config.required ? { required: true } : {})
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
      'retry',
      'clear',
      'chosen',
    ].map((key) => [key, c.t(`backend.relation.${key}`)]),
  )
  const disabled = Boolean(config.disabled) || c.busy
  return {
    ...base,
    control: recordIsland('backend.relation-select', {
      id: base.id,
      config: {
        name,
        triggerId: base.id,
        ariaLabel: base.label,
        value: base.value || null,
        options: rows.map((row) => ({ value: String(row.id), label: String(row.name) })),
        invalid: Boolean(base.error),
        describedBy: base.error ? `${base.id}-error` : undefined,
        labels: { ...labels, dialogTitle: base.label },
        ...config,
        disabled,
      },
    }),
  }
}

function draftFields(c: Context): FieldProps[] {
  const source = c.data.source
  const products = source
    ? c.data.choices.products.filter((row) => source.products.includes(String(row.id)))
    : c.data.choices.products
  const productId = c.draft('productId', String(c.data.record.productId ?? ''))
  const tracked = c.data.choices.products.find((row) => row.id === productId)?.tracking
  const lots = c.data.choices.lots
    .filter((row) => !productId || row.productId === productId)
    .map((row) => ({
      ...row,
      name: `${String(row.name)} · ${nameOf(c.data.choices.products, row.productId)}`,
    }))
  return [
    relation(c, 'warehouseId', 'field.warehouse', c.data.choices.warehouses, {
      required: true,
      // An order opened from a transfer scraps from that transfer's warehouse; a saved one keeps its own.
      disabled: Boolean(source) || !c.creating,
    }),
    relation(c, 'productId', 'field.product', products, { required: true }),
    ...(tracked === 'none' ? [] : [relation(c, 'lotId', 'field.lot', lots)]),
    field(c, 'quantity', 'scrap.quantity', { type: 'decimal', required: true }),
    field(c, 'reason', 'scrap.reason', {
      type: 'select',
      required: true,
      options: [
        { value: '', label: '—' },
        ...SCRAP_REASONS.map((value) => ({ value, label: t(c, `scrap.reason.${value}`) })),
      ],
    }),
    {
      ...field(c, 'replenish', 'scrap.replenish', { type: 'checkbox', help: t(c, 'scrap.replenishHelp') }),
      value: c.draftChecked('replenish', undefined, c.data.record.replenish === true),
    },
    field(c, 'note', 'scrap.note', { type: 'textarea' }),
  ]
}

const link = (href: string | null, label: unknown) =>
  href ? <Link href={href} label={String(label || '—')} /> : String(label || '—')

function summary(c: Context) {
  const record = c.data.record
  const item = (id: string, label: string, value: unknown) =>
    value == null || value === '' ? null : { id, label: t(c, label), value: value as string }
  return (
    <DescriptionList
      items={[
        item('warehouse', 'field.warehouse', nameOf(c.data.choices.warehouses, record.warehouseId)),
        item('product', 'field.product', nameOf(c.data.choices.products, record.productId)),
        record.lotId ? item('lot', 'field.lot', nameOf(c.data.choices.lots, record.lotId)) : null,
        item('quantity', 'scrap.quantity', record.quantity),
        item('reason', 'scrap.reason', record.reason ? t(c, `scrap.reason.${String(record.reason)}`) : ''),
        item('note', 'scrap.note', record.note),
        item('date', 'scrap.date', String(record.dateDone ?? record.date ?? '').slice(0, 10)),
        record.pickingId ? item('source', 'scrap.source', link(c.data.links.source, record.pickingId)) : null,
        record.operationId
          ? item('operation', 'scrap.operation', link(c.data.links.operation, record.name))
          : null,
        c.data.value ? item('value', 'scrap.value', c.data.value) : null,
        record.replenishmentPickingId || record.replenishmentOrderId
          ? item(
              'replenishment',
              'scrap.replenishment',
              link(c.data.links.replenishment, t(c, 'scrap.openReplenishment')),
            )
          : null,
        record.undoId ? item('undo', 'scrap.undoOperation', link(c.data.links.undo, record.name)) : null,
        item('undoReason', 'scrap.undoReason', record.undoReason),
      ].filter((entry): entry is { id: string; label: string; value: string } => entry !== null)}
    />
  )
}

export const scrapModalDefinition: RecordModalDefinition<Data> = {
  kind: 'stock.scrap',
  size: 'default',
  observeDrafts: ['productId'],
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/scrap/${record}/context?lang=${language()}`
    },
    // An order opened from a transfer carries that transfer.
    query: ['company', 'branch', 'picking'],
  },
  title: (c) => (c.creating ? t(c, 'scrap.create.title') : String(c.data.record.name)),
  status: (c) => (c.creating ? null : <Badge label={t(c, `scrap.state.${String(c.data.record.state)}`)} />),
  body: (c) => (
    <Stack
      items={[
        <ScrapHelp lang={c.data.lang} />,
        c.data.source ? (
          <Notice tone="info" title={t(c, 'scrap.fromTransfer')} message={c.data.source.name} />
        ) : null,
        !c.creating &&
        c.data.record.state === 'done' &&
        c.data.record.replenish &&
        !c.data.record.replenishmentPickingId &&
        !c.data.record.replenishmentOrderId ? (
          <Notice
            tone="warning"
            title={t(c, 'scrap.replenishMissing')}
            message={t(c, 'scrap.replenishMissingHint')}
          />
        ) : null,
        editable(c) ? (
          <Surface
            title={t(c, 'scrap.what')}
            body={
              <RecordModalForm
                kind={c.kind}
                command="save"
                columns={1}
                fields={draftFields(c)}
                body={
                  !c.creating && c.data.record.held != null ? (
                    <DescriptionList
                      items={[{ id: 'held', label: t(c, 'scrap.held'), value: String(c.data.record.held) }]}
                    />
                  ) : null
                }
                actions={[
                  <Button
                    type="submit"
                    label={c.t('recordModal.save')}
                    variant="primary"
                    disabled={c.busy}
                  />,
                ]}
              />
            }
          />
        ) : (
          <Surface title={t(c, 'scrap.what')} body={summary(c)} />
        ),
        editable(c) && !c.creating && c.data.record.operationId ? <Surface body={summary(c)} /> : null,
      ]}
    />
  ),
  actions: (c) => (
    <ActionGroup
      actions={[
        <Button name="screen-help" type="button" label={t(c, 'replenishment.help')} />,
        ...(!c.creating && c.data.record.state === 'draft' && c.data.permissions.validateScrap
          ? [
              <RecordActionForm kind={c.kind} command="validate">
                <Button type="submit" label={t(c, 'scrap.validate')} variant="primary" disabled={c.busy} />
              </RecordActionForm>,
            ]
          : []),
        ...(!c.creating && c.data.record.state === 'draft' && c.data.permissions.cancelScrap
          ? [
              <RecordActionForm kind={c.kind} command="cancel">
                <Button type="submit" label={t(c, 'scrap.cancel')} disabled={c.busy} />
              </RecordActionForm>,
            ]
          : []),
        ...(!c.creating && c.data.record.state === 'done' && c.data.permissions.undoScrap
          ? [
              <RecordDialogTrigger dialog="undo">
                <Button label={t(c, 'scrap.undo')} disabled={c.busy} />
              </RecordDialogTrigger>,
            ]
          : []),
      ]}
    />
  ),
  dialogs: {
    undo: {
      title: (c) => t(c, 'scrap.undoTitle'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="undo"
          fields={[
            field(c, 'reason', 'scrap.undoReason', {
              id: 'scrap-undo-reason',
              type: 'textarea',
              required: true,
              value: '',
            }),
          ]}
          body={<Notice tone="info" title={t(c, 'scrap.undoEffect')} message={t(c, 'scrap.undoHint')} />}
          actions={[<Button type="submit" label={t(c, 'scrap.undo')} variant="primary" disabled={c.busy} />]}
        />
      ),
    },
  },
  commands: {
    save: {
      fn: 'stock.saveScrap',
      after: 'open',
      input: (form, c) => ({
        id: c.creating ? c.data.draftId : c.id,
        ...(c.creating
          ? {
              warehouseId: String(form.get('warehouseId') ?? c.data.record.warehouseId ?? ''),
              ...(c.data.record.pickingId ? { pickingId: String(c.data.record.pickingId) } : {}),
            }
          : {}),
        productId: String(form.get('productId') ?? ''),
        lotId: form.get('lotId') ? String(form.get('lotId')) : null,
        quantity: String(form.get('quantity') ?? ''),
        reason: String(form.get('reason') ?? ''),
        replenish: form.has('replenish'),
        note: String(form.get('note') ?? ''),
      }),
    },
    validate: {
      fn: 'stock.validateScrap',
      after: 'reload',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'scrap.confirmValidate'),
    },
    cancel: {
      fn: 'stock.cancelScrap',
      after: 'reload',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'scrap.confirmCancel'),
    },
    undo: {
      fn: 'stock.undoScrap',
      after: 'reload',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
    },
  },
}

export const scrapModal = createRecordModal(scrapModalDefinition)
