import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { DescriptionList, Link } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { formatMoney } from '../../../ui/money-format.ts'
import { islands as backendIslands } from '../../backend/islands.ts'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import {
  badge,
  dataTable,
  FormCluster,
  FormPage,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export type ManufacturingOrderExecutionRow = Record<string, unknown>

/** One component of an order as the use grid shows it: totals in the product's unit. */
export type ManufacturingConsumptionRow = {
  productId: string
  product: string
  unit: string
  need: string
  consumed: string
  /** Given back to stock, already out of `consumed`. */
  returned?: string
  /** In a deployment that counts some components in pieces: whether this one is, and its use in pieces. */
  pieces?: { enabled: boolean; value: string | null }
}

/** What the floor can do besides recording use and output. */
export type ManufacturingFloorOptions = {
  /** A `warning` BOM: the use form carries the overuse confirmation. */
  warning: boolean
  /** Kilograms per unit and tolerance (%), when output is weighed. */
  weigh: { unitWeight: string; tolerance: string } | null
  /** The order's own product, which may be scrapped as well as its components. */
  product: { id: string; name: string }
  /** Whether the reader may give components back and report scrap. */
  manage: boolean
}

/** Where a drafted order came from (P12): its source, the sale or rule as a link when readable, and its deadline. */
export type ManufacturingOrderSource = {
  kind: 'sale' | 'rule' | 'manual'
  document: { label: string; href: string | null } | null
  deadline: string | null
  /** The sale was cancelled or changed after this order was confirmed (#1949). */
  notice: 'cancelled' | 'changed' | null
}

const sourceSection = (_: Translator, source: ManufacturingOrderSource) => (
  <Section
    title={_('manufacturing_backend.source.title')}
    body={stack([
      source.notice ? (
        <Notice
          tone="warning"
          title={_(`manufacturing_backend.source.notice.${source.notice}`)}
          message={_(`manufacturing_backend.source.noticeHelp.${source.notice}`)}
        />
      ) : null,
      <DescriptionList
        label={_('manufacturing_backend.source.title')}
        items={[
          {
            id: 'source',
            label: _('manufacturing_backend.field.orderSource'),
            value: _(`manufacturing_backend.orderSource.${source.kind}`),
          },
          ...(source.document
            ? [
                {
                  id: 'document',
                  label: _(`manufacturing_backend.source.${source.kind === 'sale' ? 'sale' : 'rule'}`),
                  value: source.document.href ? (
                    <Link href={source.document.href} label={source.document.label} />
                  ) : (
                    source.document.label
                  ),
                },
              ]
            : []),
          ...(source.deadline
            ? [
                {
                  id: 'deadline',
                  label: _('manufacturing_backend.source.deadline'),
                  value: new Intl.DateTimeFormat(_.locale === 'en' ? 'en-GB' : 'vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  }).format(new Date(source.deadline)),
                },
              ]
            : []),
        ]}
      />,
    ])}
  />
)

/** The quality checks of an order's lots, and whether the reader may check them. */
export type ManufacturingQuality = {
  checks: Array<{
    id: string
    lotName: string
    state: string
    ph: string | null
    sensory: string | null
    note: string | null
    /** The BOM's pH range, worded. */
    range: string
    /** Checked against a template (#1947): what it asks for while pending, what it found once checked. */
    template?: {
      criteria: Array<{ id: string; name: string; requirement: string; range: boolean; required: boolean }>
      results: Array<{ name: string; value: string; passed: boolean | null }>
    }
  }>
  check: boolean
}

/** A pending template check's criteria, one row each: a reading for a range, a verdict for a pass/fail. */
const criteriaGrid = (
  _: Translator,
  check: ManufacturingQuality['checks'][number],
  form: string,
): KetGridIslandConfig => ({
  label: _('manufacturing_backend.quality.criteriaOf', { lot: check.lotName }),
  ...ketGridLocale(_.locale === 'en' ? 'en' : 'vi'),
  columns: [
    { key: 'name', label: _('manufacturing_backend.quality.criterion'), type: 'text' },
    { key: 'requirement', label: _('manufacturing_backend.quality.requirement'), type: 'text' },
    {
      key: 'value',
      label: _('manufacturing_backend.quality.value'),
      type: 'number',
      editable: true,
      lockedBy: 'verdictOnly',
      width: 120,
    },
    {
      key: 'verdict',
      label: _('manufacturing_backend.quality.verdict'),
      type: 'select',
      editable: true,
      lockedBy: 'readingOnly',
      options: ['pass', 'fail'].map((value) => ({
        value,
        label: _(`manufacturing_backend.quality.sensory.${value}`),
      })),
      width: 140,
    },
    { key: 'required', label: _('manufacturing_backend.quality.required'), type: 'text', width: 112 },
  ],
  rows: (check.template?.criteria ?? []).map((criterion) => ({
    id: criterion.id,
    name: criterion.name,
    requirement: criterion.requirement,
    value: null,
    verdict: null,
    required: criterion.required
      ? _('manufacturing_backend.quality.requiredYes')
      : _('manufacturing_backend.quality.requiredNo'),
    verdictOnly: !criterion.range,
    readingOnly: criterion.range,
  })),
  name: 'results',
  form,
  visibleRows: 8,
})

const qualityTone = (state: string) =>
  state === 'passed' ? 'positive' : state === 'failed' ? 'danger' : 'warning'

/** Lots waiting for their check head the section; each pending lot has its own form for the foreman. */
const qualitySection = (_: Translator, quality: ManufacturingQuality, action: string) => {
  const pending = quality.checks.filter((check) => check.state === 'pending')
  return (
    <Section
      title={_('manufacturing_backend.quality.title')}
      body={stack([
        pending.length ? (
          <Notice
            tone="warning"
            title={_('manufacturing_backend.quality.pending')}
            message={_('manufacturing_backend.quality.pendingLots', {
              lots: pending.map((check) => check.lotName).join(', '),
            })}
          />
        ) : null,
        dataTable(_, {
          rows: quality.checks,
          id: (check) => check.id,
          columns: [
            {
              key: 'lot',
              label: _('manufacturing_backend.quality.lot'),
              cell: (check) => check.lotName,
              priority: 'primary',
            },
            {
              key: 'state',
              label: _('manufacturing_backend.field.state'),
              cell: (check) =>
                badge(
                  _(`manufacturing_backend.quality.state.${check.state}`),
                  qualityTone(check.state),
                  check.state,
                ),
            },
            ...(quality.checks.some((check) => !check.template)
              ? [
                  {
                    key: 'ph',
                    label: _('manufacturing_backend.quality.ph'),
                    cell: (check: ManufacturingQuality['checks'][number]) =>
                      check.template ? '—' : `${check.ph ?? '—'} (${check.range})`,
                  },
                  {
                    key: 'sensory',
                    label: _('manufacturing_backend.quality.sensory'),
                    cell: (check: ManufacturingQuality['checks'][number]) =>
                      check.sensory ? _(`manufacturing_backend.quality.sensory.${check.sensory}`) : '—',
                  },
                ]
              : []),
            ...(quality.checks.some((check) => check.template)
              ? [
                  {
                    key: 'results',
                    label: _('manufacturing_backend.quality.results'),
                    cell: (check: ManufacturingQuality['checks'][number]) =>
                      check.template?.results.length
                        ? check.template.results
                            .map(
                              (result) =>
                                `${result.name}: ${result.value}${result.passed === false ? ` (${_('manufacturing_backend.quality.sensory.fail').toLowerCase()})` : ''}`,
                            )
                            .join(' · ')
                        : '—',
                  },
                ]
              : []),
            {
              key: 'note',
              label: _('manufacturing_backend.quality.note'),
              cell: (check) => check.note ?? '—',
            },
          ],
        }),
        ...(quality.check
          ? pending.map((check) => {
              const form = `manufacturing-order-quality-${check.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
              return check.template ? (
                <Section
                  title={_('manufacturing_backend.quality.criteriaOf', { lot: check.lotName })}
                  body={stack([
                    html`${trustedMarkup(
                      renderIsland(
                        'backend.ket-grid',
                        (props) => backendIslands['backend.ket-grid'].view!(props as never),
                        { id: `${form}-criteria`, config: criteriaGrid(_, check, form) },
                      ),
                    )}`,
                    <RecordForm
                      id={form}
                      action={action}
                      hidden={{ action: 'quality', checkId: check.id }}
                      fields={[
                        { name: 'note', label: _('manufacturing_backend.quality.note'), type: 'textarea' },
                      ]}
                      submit={_('manufacturing_backend.quality.check')}
                      submitVariant="primary"
                    />,
                  ])}
                />
              ) : (
                <RecordForm
                  id={form}
                  action={action}
                  hidden={{ action: 'quality', checkId: check.id }}
                  fields={[
                    {
                      name: 'ph',
                      label: _('manufacturing_backend.quality.phOf', { lot: check.lotName }),
                      type: 'decimal',
                      required: true,
                      help: _('manufacturing_backend.quality.range', { range: check.range }),
                      span: 'half',
                    },
                    {
                      name: 'sensory',
                      label: _('manufacturing_backend.quality.sensory'),
                      type: 'select',
                      required: true,
                      options: ['pass', 'fail'].map((value) => ({
                        value,
                        label: _(`manufacturing_backend.quality.sensory.${value}`),
                      })),
                      span: 'half',
                    },
                    { name: 'note', label: _('manufacturing_backend.quality.note'), type: 'textarea' },
                  ]}
                  submit={_('manufacturing_backend.quality.check')}
                  submitVariant="primary"
                />
              )
            })
          : []),
      ])}
    />
  )
}

const CONSUME_FORM = 'manufacturing-order-consume'

const consumptionGrid = (_: Translator, rows: ManufacturingConsumptionRow[]): KetGridIslandConfig => ({
  label: _('manufacturing_backend.consume.title'),
  ...ketGridLocale(_.locale === 'en' ? 'en' : 'vi'),
  columns: [
    { key: 'product', label: _('manufacturing_backend.field.component'), type: 'text' },
    { key: 'need', label: _('manufacturing_backend.consume.need'), type: 'number' },
    // Typed pieces become the total on the server; a component not counted in pieces keeps it locked.
    ...(rows.some((row) => row.pieces)
      ? [
          {
            key: 'pieces',
            label: _('manufacturing_backend.consume.pieces'),
            type: 'number' as const,
            editable: true,
            min: 0,
            width: 96,
            lockedBy: 'piecesLocked',
          },
        ]
      : []),
    // A total, and never below what is already recorded: returning the excess is its own action.
    {
      key: 'consumed',
      label: _('manufacturing_backend.consume.consumed'),
      type: 'number',
      editable: true,
      minField: 'recorded',
    },
    { key: 'returned', label: _('manufacturing_backend.consume.returned'), type: 'number' },
    { key: 'unit', label: _('manufacturing_backend.field.uom'), type: 'text' },
  ],
  rows: rows.map((row) => ({
    id: row.productId,
    product: row.product,
    need: Number(row.need),
    consumed: Number(row.consumed),
    recorded: Number(row.consumed),
    returned: Number(row.returned ?? 0),
    unit: row.unit,
    ...(row.pieces
      ? {
          pieces: row.pieces.value == null ? null : Number(row.pieces.value),
          piecesLocked: !row.pieces.enabled,
        }
      : {}),
  })),
  name: 'components',
  form: CONSUME_FORM,
  visibleRows: 8,
})

const stateBadge = (_: Translator, value: unknown, work = false) => {
  const state = String(value ?? '')
  const key = work && _.resolves(`manufacturing_backend.workState.${state}`) ? 'workState' : 'state'
  return badge(
    _.resolves(`manufacturing_backend.${key}.${state}`) ? _(`manufacturing_backend.${key}.${state}`) : state,
    state === 'done'
      ? 'positive'
      : state === 'cancelled'
        ? 'danger'
        : state === 'in_progress'
          ? 'warning'
          : 'neutral',
    state,
  )
}

/**
 * Header actions. Once some output is recorded the order closes from its output section instead,
 * which asks what happens to the rest; booking everything at once is only for an untouched order.
 */
const orderActions = (_: Translator, state: unknown, produced: number) =>
  produced > 0 && state !== 'draft'
    ? []
    : state === 'draft'
      ? [{ value: 'confirm', label: _('manufacturing_backend.action.confirm'), variant: 'primary' as const }]
      : state === 'confirmed'
        ? [
            { value: 'start', label: _('manufacturing_backend.action.start'), variant: 'primary' as const },
            {
              value: 'complete',
              label: _('manufacturing_backend.action.complete'),
              variant: 'secondary' as const,
            },
          ]
        : state === 'in_progress'
          ? [
              {
                value: 'complete',
                label: _('manufacturing_backend.action.complete'),
                variant: 'primary' as const,
              },
            ]
          : []

const workActions = (_: Translator, state: unknown) =>
  state === 'ready' || state === 'paused'
    ? [
        {
          value: 'start-work',
          label: _('manufacturing_backend.action.start'),
          variant: 'primary' as const,
        },
      ]
    : state === 'in_progress'
      ? [
          {
            value: 'pause-work',
            label: _('manufacturing_backend.action.pause'),
            variant: 'secondary' as const,
          },
          {
            value: 'finish-work',
            label: _('manufacturing_backend.action.finish'),
            variant: 'primary' as const,
          },
        ]
      : []

/** FormPage shell with specialized execution tables for work orders and stock moves. */
export const orderScreen = (
  _: Translator,
  frame: Frame,
  row: ManufacturingOrderExecutionRow,
  errors: string[] = [],
  action = `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`,
  /** What the queue says this open order is short of, each line already worded. */
  shortages: string[] = [],
  /** The order's components and their recorded use, when the reader may record it. */
  consumption: ManufacturingConsumptionRow[] = [],
  /** Whether the reader may book finished goods and close the order, and the order's unit. */
  output: { record: boolean; close: boolean; unit: string } = { record: false, close: false, unit: '' },
  /** The order's cost per unit, only for a reader holding the cost grant. */
  cost: {
    provisional: string
    issued: string
    actual: string | null
    currency: string
    /** What closing settled, once it has. */
    labour?: string | null
    varianceHeld?: string | null
    varianceSold?: string | null
  } | null = null,
  floor: ManufacturingFloorOptions | null = null,
  quality: ManufacturingQuality | null = null,
  source: ManufacturingOrderSource | null = null,
): TemplateResult => {
  const overused = consumption.filter((entry) => Number(entry.consumed) > Number(entry.need) + 1e-9)
  const recording = ['confirmed', 'in_progress'].includes(String(row.state)) && consumption.length > 0
  // Cancelling asks why, and stops once output is booked: then the order closes instead.
  const cancellable =
    ['draft', 'confirmed', 'in_progress'].includes(String(row.state)) &&
    !(Number(row.quantityProduced ?? 0) > 0)
  const workOrders = (row.workOrders as ManufacturingOrderExecutionRow[] | undefined) ?? []
  const moves = (row.moves as ManufacturingOrderExecutionRow[] | undefined) ?? []
  const produced = Number(row.quantityProduced ?? 0)
  const planned = Number(row.productQty)
  const open = ['confirmed', 'in_progress'].includes(String(row.state))
  const actions = orderActions(_, row.state, produced)
  const workAction = (work: ManufacturingOrderExecutionRow) => {
    const target = new URL(action, 'http://ket.local')
    target.searchParams.set('workOrderId', String(work.id))
    target.searchParams.set('workOrderVersion', String(work.version))
    return `${target.pathname}${target.search}`
  }
  const page = (
    <FormPage
      variant="operational"
      frame={frame}
      scope="manufacturing-order-execution-form-page"
      title={String(row.name)}
      status={stateBadge(_, row.state)}
      meta={badge(`${_('manufacturing_backend.field.quantity')}: ${String(row.productQty)}`, 'neutral')}
      actions={
        actions.length ? (
          <FormCluster
            label={_('manufacturing_backend.orders.detail')}
            forms={[<RecordActions action={action} actions={actions} />]}
          />
        ) : undefined
      }
      body={stack([
        errors.length ? (
          <Notice
            tone="danger"
            title={_('manufacturing_backend.error.invalid')}
            message={errors.join(' · ')}
          />
        ) : null,
        shortages.length ? (
          <Notice
            tone="warning"
            title={_('manufacturing_backend.orders.shortTitle')}
            message={shortages.join(' · ')}
          />
        ) : null,
        overused.length ? (
          <Notice
            tone="warning"
            title={_('manufacturing_backend.consume.overused')}
            message={overused
              .map((entry) => `${entry.product}: ${entry.consumed} / ${entry.need} ${entry.unit}`)
              .join(' · ')}
          />
        ) : null,
        recording ? (
          <Section
            title={_('manufacturing_backend.consume.title')}
            body={stack([
              html`${trustedMarkup(
                renderIsland(
                  'backend.ket-grid',
                  (props) => backendIslands['backend.ket-grid'].view!(props as never),
                  { id: 'manufacturing-order-components', config: consumptionGrid(_, consumption) },
                ),
              )}`,
              <RecordForm
                id={CONSUME_FORM}
                action={action}
                hidden={{ action: 'consume' }}
                fields={
                  floor?.warning
                    ? [
                        {
                          name: 'confirmOveruse',
                          label: _('manufacturing_backend.consume.confirmOveruse'),
                          type: 'checkbox',
                        },
                      ]
                    : []
                }
                submit={_('manufacturing_backend.consume.record')}
                submitVariant="primary"
              />,
            ])}
          />
        ) : null,
        open && (output.record || (output.close && produced > 0)) ? (
          <Section
            title={_('manufacturing_backend.output.title')}
            body={stack([
              <Notice
                tone={produced > 0 ? 'positive' : 'info'}
                title={_('manufacturing_backend.output.made', {
                  produced: String(produced),
                  planned: String(planned),
                  unit: output.unit,
                })}
                message={_('manufacturing_backend.output.hint')}
              />,
              output.record ? (
                <RecordForm
                  id="manufacturing-order-output"
                  action={action}
                  hidden={{ action: 'output' }}
                  fields={[
                    {
                      name: 'quantity',
                      label: _('manufacturing_backend.output.quantity', { unit: output.unit }),
                      type: 'decimal',
                      required: true,
                      span: 'half',
                    },
                    {
                      name: 'lotName',
                      label: _('manufacturing_backend.output.lot'),
                      help: _('manufacturing_backend.output.lotHelp'),
                      span: 'half',
                    },
                    ...(floor?.weigh
                      ? [
                          {
                            name: 'weight',
                            label: _('manufacturing_backend.output.weight'),
                            type: 'decimal' as const,
                            required: true,
                            help: _('manufacturing_backend.output.weightHelp', floor.weigh),
                            span: 'half' as const,
                          },
                        ]
                      : []),
                  ]}
                  submit={_('manufacturing_backend.output.record')}
                  submitVariant="primary"
                />
              ) : null,
              output.close && produced > 0 ? (
                <RecordForm
                  id="manufacturing-order-close"
                  action={action}
                  hidden={{ action: 'close', ...(produced >= planned ? { rest: 'close' } : {}) }}
                  fields={
                    produced >= planned
                      ? []
                      : [
                          {
                            name: 'rest',
                            label: _('manufacturing_backend.output.rest', {
                              rest: String(Math.round((planned - produced) * 1e6) / 1e6),
                              unit: output.unit,
                            }),
                            type: 'radio',
                            required: true,
                            value: 'backorder',
                            options: [
                              { value: 'backorder', label: _('manufacturing_backend.output.backorder') },
                              { value: 'close', label: _('manufacturing_backend.output.closeShort') },
                            ],
                          },
                        ]
                  }
                  submit={_('manufacturing_backend.output.close')}
                  submitVariant="secondary"
                />
              ) : null,
            ])}
          />
        ) : null,
        source && source.kind !== 'manual' ? sourceSection(_, source) : null,
        quality?.checks.length ? qualitySection(_, quality, action) : null,
        cost ? (
          <Section
            title={_('manufacturing_backend.cost.title')}
            body={
              <DescriptionList
                label={_('manufacturing_backend.cost.title')}
                columns="auto"
                items={[
                  {
                    id: 'provisional',
                    label: _('manufacturing_backend.cost.provisional', { unit: output.unit }),
                    value: formatMoney(_, cost.provisional, cost.currency),
                  },
                  {
                    id: 'issued',
                    label: _('manufacturing_backend.cost.issued'),
                    value: formatMoney(_, cost.issued, cost.currency),
                  },
                  ...(
                    [
                      ['labour', cost.labour],
                      ['varianceHeld', cost.varianceHeld],
                      ['varianceSold', cost.varianceSold],
                    ] as const
                  )
                    .filter(([, value]) => value != null)
                    .map(([key, value]) => ({
                      id: key,
                      label: _(`manufacturing_backend.cost.${key}`),
                      value: formatMoney(_, value, cost.currency),
                    })),
                  ...(cost.actual == null
                    ? []
                    : [
                        {
                          id: 'actual',
                          label: _('manufacturing_backend.cost.actual', { unit: output.unit }),
                          value: formatMoney(_, cost.actual, cost.currency),
                        },
                      ]),
                ]}
              />
            }
          />
        ) : null,
        open && floor?.manage ? (
          <Section
            title={_('manufacturing_backend.floor.title')}
            body={stack([
              consumption.some((entry) => Number(entry.consumed) > 0) ? (
                <RecordForm
                  id="manufacturing-order-return"
                  action={action}
                  hidden={{ action: 'return' }}
                  fields={[
                    {
                      name: 'productId',
                      label: _('manufacturing_backend.field.component'),
                      type: 'select',
                      required: true,
                      options: consumption
                        .filter((entry) => Number(entry.consumed) > 0)
                        .map((entry) => ({
                          value: entry.productId,
                          label: `${entry.product} · ${_('manufacturing_backend.floor.inUse', {
                            consumed: entry.consumed,
                            unit: entry.unit,
                          })}`,
                        })),
                      span: 'half',
                    },
                    {
                      name: 'quantity',
                      label: _('manufacturing_backend.floor.returnQuantity'),
                      type: 'decimal',
                      required: true,
                      span: 'half',
                    },
                  ]}
                  submit={_('manufacturing_backend.floor.return')}
                  submitVariant="secondary"
                />
              ) : null,
              <RecordForm
                id="manufacturing-order-scrap"
                action={action}
                hidden={{ action: 'scrap' }}
                fields={[
                  {
                    name: 'productId',
                    label: _('manufacturing_backend.floor.scrapProduct'),
                    type: 'select',
                    required: true,
                    options: [
                      { value: floor.product.id, label: floor.product.name },
                      ...consumption.map((entry) => ({ value: entry.productId, label: entry.product })),
                    ],
                    span: 'half',
                  },
                  {
                    name: 'quantity',
                    label: _('manufacturing_backend.floor.scrapQuantity'),
                    type: 'decimal',
                    required: true,
                    span: 'half',
                  },
                  {
                    name: 'reason',
                    label: _('manufacturing_backend.floor.reason'),
                    type: 'textarea',
                    required: true,
                  },
                ]}
                submit={_('manufacturing_backend.floor.scrap')}
                submitVariant="secondary"
              />,
            ])}
          />
        ) : null,
        row.state === 'done' && row.closedShort ? (
          <Notice
            tone="warning"
            title={_('manufacturing_backend.output.closedShort')}
            message={_('manufacturing_backend.output.made', {
              produced: String(produced),
              planned: String(planned),
              unit: output.unit,
            })}
          />
        ) : null,
        row.state === 'cancelled' && row.cancelReason ? (
          <Notice
            tone="info"
            title={_('manufacturing_backend.field.cancelReason')}
            message={String(row.cancelReason)}
          />
        ) : null,
        workOrders.length ? (
          <Section
            title={_('manufacturing_backend.field.operation')}
            body={dataTable(_, {
              rows: workOrders,
              id: (work) => String(work.id),
              rowHref: (work) => {
                const target = new URL(action, 'http://ket.local')
                target.pathname = `/admin/manufacturing/work/${encodeURIComponent(String(work.id))}`
                target.search = target.searchParams.get('lang')
                  ? `?lang=${target.searchParams.get('lang')}`
                  : ''
                return `${target.pathname}${target.search}`
              },
              columns: [
                {
                  key: 'name',
                  label: _('manufacturing_backend.field.name'),
                  cell: (work) => String(work.name),
                  priority: 'primary',
                },
                {
                  key: 'state',
                  label: _('manufacturing_backend.field.state'),
                  cell: (work) => stateBadge(_, work.state, true),
                },
                {
                  key: 'actions',
                  label: _('manufacturing_backend.field.actions'),
                  cell: (work) => {
                    const actions = workActions(_, work.state)
                    return actions.length ? <RecordActions action={workAction(work)} actions={actions} /> : ''
                  },
                },
              ],
            })}
          />
        ) : null,
        moves.length ? (
          <Section
            title={_('manufacturing_backend.orders.moves')}
            body={dataTable(_, {
              rows: moves,
              id: (move) => String(move.id),
              columns: [
                {
                  key: 'kind',
                  label: _('manufacturing_backend.field.moveKind'),
                  cell: (move) =>
                    _.resolves(`manufacturing_backend.moveKind.${String(move.kind)}`)
                      ? _(`manufacturing_backend.moveKind.${String(move.kind)}`)
                      : String(move.kind),
                },
                {
                  key: 'quantity',
                  label: _('manufacturing_backend.field.quantity'),
                  cell: (move) =>
                    String((move.move as ManufacturingOrderExecutionRow | undefined)?.productUomQty ?? ''),
                },
              ],
            })}
          />
        ) : null,
        cancellable ? (
          <Section
            title={_('manufacturing_backend.orders.cancelTitle')}
            body={
              <RecordForm
                id="manufacturing-order-cancel"
                action={action}
                hidden={{ action: 'cancel' }}
                fields={[
                  {
                    name: 'reason',
                    label: _('manufacturing_backend.field.cancelReason'),
                    type: 'textarea',
                    required: true,
                  },
                ]}
                submit={_('manufacturing_backend.action.cancelOrder')}
                submitVariant="destructive"
              />
            }
          />
        ) : null,
      ])}
    />
  )

  return shell(_, String(row.name), page, { ...frame, topbar: false, titled: false })
}
