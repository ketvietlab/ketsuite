import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  formatDateTime,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  FormCluster,
  FormPage,
  LinkButton,
  ListPage,
  Notice,
  prepareCollectionTable,
  RecordActions,
  RecordForm,
  Section,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

export type WorkOrderListRow = {
  id: string
  order: string
  name: string
  workCenter: string
  operator: string
  minutes: number
  state: string
  /** Position in the floor's queue, which the list is sorted by unless the reader sorts. */
  queue: number
  href: string
}

const workTone = (state: string): 'positive' | 'warning' | 'info' | 'neutral' =>
  state === 'done' ? 'positive' : state === 'in_progress' ? 'warning' : state === 'ready' ? 'info' : 'neutral'

const workBadge = (_: Translator, state: string) =>
  badge(
    _.resolves(`manufacturing_backend.workState.${state}`)
      ? _(`manufacturing_backend.workState.${state}`)
      : state,
    workTone(state),
    state,
  )

export const workOrderListColumns = (_: Translator): Array<Column<WorkOrderListRow>> => [
  {
    key: 'order',
    label: _('manufacturing_backend.work.order'),
    cell: (row) => row.order,
    priority: 'primary',
  },
  {
    key: 'name',
    label: _('manufacturing_backend.field.operation'),
    cell: (row) => row.name,
    priority: 'secondary',
    width: 'wide',
  },
  { key: 'workCenter', label: _('manufacturing_backend.work.center'), cell: (row) => row.workCenter },
  {
    key: 'operator',
    label: _('manufacturing_backend.work.operator'),
    cell: (row) => row.operator || _('manufacturing_backend.work.unassigned'),
  },
  {
    key: 'minutes',
    label: _('manufacturing_backend.work.minutes'),
    cell: (row) => String(row.minutes),
    align: 'end',
  },
  {
    key: 'state',
    label: _('manufacturing_backend.field.state'),
    cell: (row) => workBadge(_, row.state),
    kind: 'status',
  },
]

/** The floor's operations, open ones first in the order a worker takes them. */
export const workOrdersListScreen = (
  _: Translator,
  options: { rows: WorkOrderListRow[]; table?: Partial<DataTable<WorkOrderListRow>> },
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
      columns: workOrderListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('manufacturing_backend.work.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('manufacturing_backend.work.title')}
      controls={collectionControls(_, _('manufacturing_backend.work.title'), collection.frame)}
      actions={collectionActions(_, collection.frame)}
      footer={`${_('manufacturing_backend.work.title')}: ${String(collection.total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, collection.table)
          : emptyState(_('manufacturing_backend.work.empty'), _('manufacturing_backend.work.emptyHint'))
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}

export type WorkOrderPageOptions = {
  row: Record<string, unknown>
  action: string
  orderHref: string
  errors?: readonly string[]
  /**
   * What the reader may do: run the operation (start/pause/finish), take it for themselves, give
   * it to someone, and on the last operation book finished goods.
   */
  may: { work: boolean; assign: boolean; take: boolean; output: boolean }
  /** The order's unit, and the weighing the BOM asks for, for the last operation's output form. */
  unit?: string
  weigh?: { unitWeight: string; tolerance: string } | null
  /** Values to show again after a refusal. */
  values?: Record<string, string>
}

/** One operation: run it by state, finish it with the minutes it took, give it to someone. */
export const workOrderScreen = (
  _: Translator,
  frame: Frame,
  options: WorkOrderPageOptions,
): TemplateResult => {
  const { row, action, may } = options
  const state = String(row.state)
  const open = ['pending', 'ready', 'in_progress', 'paused'].includes(state)
  const actions =
    may.work && (state === 'ready' || state === 'paused')
      ? [
          {
            value: 'start',
            label: _(
              state === 'paused'
                ? 'manufacturing_backend.action.resume'
                : 'manufacturing_backend.action.start',
            ),
            variant: 'primary' as const,
          },
        ]
      : may.take && open && state !== 'in_progress'
        ? [{ value: 'take', label: _('manufacturing_backend.work.take'), variant: 'secondary' as const }]
        : []
  const running = state === 'in_progress'
  const runMinutes = (name: string, label: string) => ({
    name,
    label,
    type: 'number' as const,
    required: true,
    step: '1',
    value: options.values?.[name] ?? '',
    span: 'half' as const,
  })
  const runs = (row.runs as Array<Record<string, unknown>> | undefined) ?? []
  const operators = (row.operators as Array<Record<string, unknown>> | undefined) ?? []
  const title = `${String(row.productionName)} · ${String(row.name)}`
  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="manufacturing-work-order-page"
      title={title}
      status={workBadge(_, state)}
      meta={badge(
        `${_('manufacturing_backend.work.center')}: ${String(row.workCenterName ?? '—')} · ${_(
          'manufacturing_backend.work.minutes',
        )}: ${String(row.durationExpected)}`,
        'neutral',
      )}
      actions={
        <FormCluster
          label={_('manufacturing_backend.work.title')}
          forms={[
            <LinkButton
              label={_('manufacturing_backend.work.openOrder')}
              href={options.orderHref}
              variant="tertiary"
            />,
            ...(actions.length ? [<RecordActions action={action} actions={actions} />] : []),
          ]}
        />
      }
      body={stack([
        options.errors?.length ? (
          <Notice
            tone="danger"
            title={_('manufacturing_backend.error.invalid')}
            message={options.errors.join(' · ')}
          />
        ) : null,
        state === 'pending' ? (
          <Notice
            tone="info"
            title={_('manufacturing_backend.workState.pending')}
            message={_('manufacturing_backend.work.pendingHint')}
          />
        ) : null,
        <Section
          title={_('manufacturing_backend.work.operator')}
          body={stack([
            <Notice
              tone={row.operatorName ? 'info' : 'warning'}
              title={String(row.operatorName ?? _('manufacturing_backend.work.unassigned'))}
              message={
                row.skill
                  ? _('manufacturing_backend.work.skillHint', {
                      skill: _.resolves(`manufacturing_backend.skill.${String(row.skill)}`)
                        ? _(`manufacturing_backend.skill.${String(row.skill)}`)
                        : String(row.skill),
                    })
                  : _('manufacturing_backend.work.anyoneHint')
              }
            />,
            may.take && open && running ? (
              <RecordForm
                id="manufacturing-work-take"
                action={action}
                hidden={{ action: 'take' }}
                fields={[runMinutes('minutes', _('manufacturing_backend.work.previousMinutes'))]}
                submit={_('manufacturing_backend.work.take')}
                submitVariant="secondary"
              />
            ) : null,
            may.assign && open ? (
              <RecordForm
                id="manufacturing-work-assign"
                action={action}
                hidden={{ action: 'assign' }}
                fields={[
                  ...(running
                    ? [runMinutes('assignMinutes', _('manufacturing_backend.work.previousMinutes'))]
                    : []),
                  {
                    name: 'operatorId',
                    label: _('manufacturing_backend.work.assignTo'),
                    type: 'select',
                    value: options.values?.operatorId ?? String(row.operatorId ?? ''),
                    options: [
                      { value: '', label: _('manufacturing_backend.work.unassigned') },
                      ...operators.map((operator) => ({
                        value: String(operator.id),
                        label:
                          operator.level == null
                            ? String(operator.name)
                            : `${String(operator.name)} · ${_('manufacturing_backend.work.level', {
                                level: String(operator.level),
                              })}`,
                      })),
                    ],
                  },
                ]}
                submit={_('manufacturing_backend.work.assign')}
                submitVariant="secondary"
              />
            ) : null,
          ])}
        />,
        may.work && running ? (
          <Section
            title={_('manufacturing_backend.action.pause')}
            body={
              <RecordForm
                id="manufacturing-work-pause"
                action={action}
                hidden={{ action: 'pause' }}
                fields={[runMinutes('pauseMinutes', _('manufacturing_backend.work.runMinutes'))]}
                submit={_('manufacturing_backend.action.pause')}
                submitVariant="secondary"
              />
            }
          />
        ) : null,
        may.work && (state === 'in_progress' || state === 'paused') ? (
          <Section
            title={_('manufacturing_backend.action.finish')}
            body={
              <RecordForm
                id="manufacturing-work-finish"
                action={action}
                hidden={{ action: 'finish' }}
                fields={[
                  {
                    name: 'actualMinutes',
                    label: _('manufacturing_backend.work.actualMinutes'),
                    type: 'number',
                    required: true,
                    step: '1',
                    value: options.values?.actualMinutes ?? '',
                    span: 'half',
                  },
                  {
                    name: 'loss',
                    label: _('manufacturing_backend.work.loss', { unit: options.unit ?? '' }),
                    type: 'decimal',
                    value: options.values?.loss ?? '',
                    span: 'half',
                  },
                  {
                    name: 'note',
                    label: _('manufacturing_backend.work.note'),
                    type: 'textarea',
                    value: options.values?.note ?? '',
                  },
                ]}
                submit={_('manufacturing_backend.action.finish')}
                submitVariant="primary"
              />
            }
          />
        ) : null,
        may.output &&
        row.last &&
        ['ready', 'in_progress', 'paused', 'done'].includes(state) &&
        ['confirmed', 'in_progress'].includes(String(row.productionState)) ? (
          <Section
            title={_('manufacturing_backend.output.title')}
            body={stack([
              <Notice
                tone="info"
                title={_('manufacturing_backend.output.made', {
                  produced: String(row.quantityProduced ?? 0),
                  planned: String(row.productQty),
                  unit: options.unit ?? '',
                })}
                message={_('manufacturing_backend.work.lastHint')}
              />,
              <RecordForm
                id="manufacturing-work-output"
                action={action}
                hidden={{ action: 'output' }}
                fields={[
                  {
                    name: 'quantity',
                    label: _('manufacturing_backend.output.quantity', { unit: options.unit ?? '' }),
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
                  ...(options.weigh
                    ? [
                        {
                          name: 'weight',
                          label: _('manufacturing_backend.output.weight'),
                          type: 'decimal' as const,
                          required: true,
                          help: _('manufacturing_backend.output.weightHelp', options.weigh),
                          span: 'half' as const,
                        },
                      ]
                    : []),
                ]}
                submit={_('manufacturing_backend.output.record')}
                submitVariant="primary"
              />,
            ])}
          />
        ) : null,
        runs.length ? (
          <Section
            title={_('manufacturing_backend.work.runs')}
            body={dataTable(_, {
              rows: runs,
              id: (run) => String(run.id),
              columns: [
                {
                  key: 'operator',
                  label: _('manufacturing_backend.work.operator'),
                  cell: (run) => String(run.operatorName ?? _('manufacturing_backend.work.unassigned')),
                  priority: 'primary',
                },
                {
                  key: 'startedAt',
                  label: _('manufacturing_backend.work.startedAt'),
                  cell: (run) =>
                    formatDateTime(_.locale, Date.parse(String(run.startedAt)), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                },
                {
                  key: 'minutes',
                  label: _('manufacturing_backend.work.runMinutes'),
                  cell: (run) =>
                    run.stoppedAt ? String(run.minutes ?? 0) : _('manufacturing_backend.work.running'),
                  align: 'end',
                },
              ],
            })}
          />
        ) : null,
        state === 'done' ? (
          <Notice
            tone="positive"
            title={_('manufacturing_backend.work.took', { minutes: String(row.durationActual) })}
            message={[
              String(row.note ?? '') || _('manufacturing_backend.work.noNote'),
              row.loss == null
                ? ''
                : _('manufacturing_backend.work.lossDone', {
                    loss: String(row.loss),
                    unit: options.unit ?? '',
                  }),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ) : null,
      ])}
    />,
    { ...frame, topbar: false, titled: false },
  )
}
