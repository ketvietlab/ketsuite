import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  linkButton,
  ModalSheet,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

/** The skills a work center can ask for; a deployment may store others, shown as written. */
export const WORK_CENTER_SKILLS = ['weigh', 'cook', 'cut', 'pack'] as const

/** A work order waiting at a work center, as `manufacturing.getWorkCenter` lists it. */
export type WorkCenterQueueRow = {
  id: string
  name: string
  state: string
  productionName?: string | null
  scheduledStart?: string | null
  durationExpected?: string | number | null
}

export type WorkCenterFormValues = {
  id?: string
  code?: string
  name?: string
  skill?: string
  capacity?: string
  timeEfficiency?: string
  costPerHour?: string
}

export type WorkCenterFormScreenOptions = {
  values?: WorkCenterFormValues
  editing?: boolean
  /** Locale-aware form endpoint supplied by the route. */
  action: string
  /** Locale-aware work-center collection destination. */
  cancelHref: string
  errors?: readonly string[]
  /** Without the configure grant the dialog shows the queue alone. */
  readOnly?: boolean
  /** Open work orders at this work center, shown under the form when editing. */
  queue?: readonly WorkCenterQueueRow[]
}

export const workCenterFields = (_: Translator, values: WorkCenterFormValues = {}): FormField[] => [
  {
    name: 'code',
    label: _('manufacturing_backend.field.code'),
    value: values.code,
    required: true,
  },
  {
    name: 'name',
    label: _('manufacturing_backend.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'skill',
    label: _('manufacturing_backend.field.skill'),
    type: 'select',
    value: values.skill ?? '',
    options: [
      { value: '', label: '—' },
      ...(values.skill && !(WORK_CENTER_SKILLS as readonly string[]).includes(values.skill)
        ? [{ value: values.skill, label: values.skill }]
        : []),
      ...WORK_CENTER_SKILLS.map((skill) => ({
        value: skill,
        label: _(`manufacturing_backend.skill.${skill}`),
      })),
    ],
  },
  {
    name: 'capacity',
    label: _('manufacturing_backend.field.capacity'),
    type: 'decimal',
    value: values.capacity || 1,
    required: true,
  },
  {
    name: 'timeEfficiency',
    label: _('manufacturing_backend.field.efficiency'),
    type: 'decimal',
    value: values.timeEfficiency || 100,
    required: true,
  },
  {
    name: 'costPerHour',
    label: _('manufacturing_backend.field.cost'),
    type: 'number',
    value: values.costPerHour || 0,
  },
]

const titleOf = (_: Translator, editing: boolean): string =>
  editing ? _('manufacturing_backend.workCenters.edit') : _('manufacturing_backend.workCenters.create')

const queueTable = (_: Translator, queue: readonly WorkCenterQueueRow[]): TemplateResult =>
  queue.length
    ? dataTable(_, {
        rows: [...queue],
        id: (row) => row.id,
        columns: [
          {
            key: 'operation',
            label: _('manufacturing_backend.field.operation'),
            cell: (row) => row.name,
            priority: 'primary',
          },
          {
            key: 'production',
            label: _('manufacturing_backend.field.order'),
            cell: (row) => String(row.productionName ?? '—'),
          },
          {
            key: 'state',
            label: _('manufacturing_backend.field.state'),
            cell: (row) => badge(_(`manufacturing_backend.workState.${row.state}`), 'neutral', row.state),
            kind: 'status',
          },
          {
            key: 'duration',
            label: _('manufacturing_backend.field.duration'),
            cell: (row) => String(row.durationExpected ?? '—'),
            align: 'end',
          },
        ],
      })
    : emptyState(_('manufacturing_backend.queue.empty'), _('manufacturing_backend.queue.emptyHint'))

export const workCenterFormModal = (_: Translator, options: WorkCenterFormScreenOptions): TemplateResult => {
  const editing = options.editing === true
  const form = options.readOnly ? null : (
    <RecordForm
      id="manufacturing-work-center-form"
      scope="manufacturing-work-center"
      action={options.action}
      hidden={options.values?.id ? { id: options.values.id } : undefined}
      fields={workCenterFields(_, options.values)}
      errors={options.errors}
      submit={editing ? _('manufacturing_backend.action.save') : _('manufacturing_backend.action.create')}
      submitVariant="primary"
      cancelHref={options.cancelHref}
      cancelLabel={_('manufacturing_backend.action.cancel')}
    />
  )
  return (
    <ModalSheet
      id="manufacturing-work-center-form"
      title={options.readOnly ? String(options.values?.name ?? '') : titleOf(_, editing)}
      closeHref={options.cancelHref}
      closeLabel={_('manufacturing_backend.action.cancel')}
      presentation="dialog"
      body={
        options.queue
          ? stack(
              [
                form,
                <Section
                  title={_('manufacturing_backend.queue.title')}
                  body={queueTable(_, options.queue)}
                />,
              ],
              'loose',
            )
          : (form ?? '')
      }
    />
  )
}

export const workCenterFormScreen = (
  _: Translator,
  options: WorkCenterFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'manufacturing-work-center-form'
  const editing = options.editing === true
  const title = titleOf(_, editing)

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="manufacturing-work-center-form-page"
      title={title}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: editing
                ? _('manufacturing_backend.action.save')
                : _('manufacturing_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('manufacturing_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="manufacturing-work-center"
              action={options.action}
              hidden={options.values?.id ? { id: options.values.id } : undefined}
              fields={workCenterFields(_, options.values)}
              errors={options.errors}
              submit={
                editing ? _('manufacturing_backend.action.save') : _('manufacturing_backend.action.create')
              }
              submitVariant="primary"
              submitPlacement="external"
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
