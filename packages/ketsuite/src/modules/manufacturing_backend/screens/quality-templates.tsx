import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { DescriptionList } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { islands as backendIslands } from '../../backend/islands.ts'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  LinkButton,
  ListPage,
  Notice,
  prepareCollectionTable,
  RecordForm,
  RecordPage,
  Section,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'

/**
 * Quality templates (#1947): what a finished product's lots are checked for. Set up once per product
 * and then left alone, so they sit behind the settings gear beside the work centers.
 */

export type QualityTemplateListRow = {
  id: string
  name: string
  product: string
  criteria: number
  active: boolean
  href: string
}

export type QualityTemplateCriterion = {
  name: string
  kind: 'range' | 'passFail'
  min: string | null
  max: string | null
  unit: string | null
  required: boolean
}

export type QualityTemplateRecord = {
  id: string
  name: string
  productId: string | null
  active: boolean
  version: number | null
  criteria: QualityTemplateCriterion[]
}

const listColumns = (_: Translator): Array<Column<QualityTemplateListRow>> => [
  {
    key: 'name',
    label: _('manufacturing_backend.field.name'),
    cell: (row) => row.name,
    priority: 'primary',
    width: 'wide',
  },
  { key: 'product', label: _('manufacturing_backend.field.product'), cell: (row) => row.product },
  {
    key: 'criteria',
    label: _('manufacturing_backend.qualityTemplates.criteria'),
    cell: (row) => String(row.criteria),
    kind: 'number',
  },
  {
    key: 'state',
    label: _('manufacturing_backend.field.state'),
    cell: (row) =>
      badge(
        _(
          row.active
            ? 'manufacturing_backend.qualityTemplates.active'
            : 'manufacturing_backend.qualityTemplates.archived',
        ),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
  },
]

export const qualityTemplatesListScreen = (
  _: Translator,
  options: {
    rows: QualityTemplateListRow[]
    createHref: string | null
    table?: Partial<DataTable<QualityTemplateListRow>>
  },
  frame: Frame = {},
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.href,
      columns: listColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('manufacturing_backend.qualityTemplates.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('manufacturing_backend.qualityTemplates.title')}
      controls={collectionControls(_, _('manufacturing_backend.qualityTemplates.title'), collection.frame)}
      headerActions={
        options.createHref ? (
          <LinkButton
            label={_('manufacturing_backend.qualityTemplates.create')}
            href={options.createHref}
            variant="primary"
          />
        ) : undefined
      }
      actions={collectionActions(_, collection.frame)}
      footer={`${_('manufacturing_backend.qualityTemplates.title')}: ${String(collection.total)}`}
      body={
        options.rows.length
          ? collectionTable(_, collection.table)
          : emptyState(
              _('manufacturing_backend.qualityTemplates.empty'),
              _('manufacturing_backend.qualityTemplates.emptyHint'),
            )
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}

export const QUALITY_TEMPLATE_FORM = 'manufacturing-quality-template'

const criteriaGrid = (
  _: Translator,
  record: QualityTemplateRecord,
  editable: boolean,
): KetGridIslandConfig => ({
  label: _('manufacturing_backend.qualityTemplates.criteria'),
  ...ketGridLocale(_.locale === 'en' ? 'en' : 'vi'),
  columns: [
    {
      key: 'name',
      label: _('manufacturing_backend.quality.criterion'),
      type: 'text',
      editable,
      required: true,
      width: 200,
      grow: 1,
    },
    {
      key: 'kind',
      label: _('manufacturing_backend.qualityTemplates.kind'),
      type: 'select',
      editable,
      required: true,
      options: ['range', 'passFail'].map((value) => ({
        value,
        label: _(`manufacturing_backend.qualityTemplates.kind.${value}`),
      })),
      width: 160,
    },
    {
      key: 'min',
      label: _('manufacturing_backend.qualityTemplates.min'),
      type: 'number',
      editable,
      width: 104,
    },
    {
      key: 'max',
      label: _('manufacturing_backend.qualityTemplates.max'),
      type: 'number',
      editable,
      width: 104,
    },
    {
      key: 'unit',
      label: _('manufacturing_backend.qualityTemplates.unit'),
      type: 'text',
      editable,
      width: 96,
    },
    {
      key: 'required',
      label: _('manufacturing_backend.quality.required'),
      type: 'checkbox',
      editable,
      width: 112,
    },
  ],
  rows: record.criteria.map((criterion, index) => ({
    id: String(index + 1),
    name: criterion.name,
    kind: criterion.kind,
    min: criterion.min == null ? null : Number(criterion.min),
    max: criterion.max == null ? null : Number(criterion.max),
    unit: criterion.unit ?? '',
    required: criterion.required,
  })),
  name: 'criteria',
  form: QUALITY_TEMPLATE_FORM,
  visibleRows: 10,
  ...(editable
    ? {
        newRow: { name: '', kind: 'range', min: null, max: null, unit: '', required: true },
        removable: true,
        reorderable: true,
      }
    : { readOnly: true }),
})

export const qualityTemplateScreen = (
  _: Translator,
  frame: Frame,
  record: QualityTemplateRecord,
  options: {
    action: string
    products: Array<{ value: string; label: string }>
    configure: boolean
    errors: string[]
    saved: boolean
  },
): TemplateResult => {
  const title = record.version == null ? _('manufacturing_backend.qualityTemplates.create') : record.name
  return shell(
    _,
    title,
    <RecordPage
      variant="operational"
      frame={frame}
      title={title}
      status={
        record.version == null
          ? undefined
          : badge(
              _(
                record.active
                  ? 'manufacturing_backend.qualityTemplates.active'
                  : 'manufacturing_backend.qualityTemplates.archived',
              ),
              record.active ? 'positive' : 'neutral',
              record.active ? 'active' : 'archived',
            )
      }
      body={stack([
        options.errors.length ? (
          <Notice
            tone="danger"
            title={_('manufacturing_backend.error.invalid')}
            message={options.errors.join(' ')}
          />
        ) : null,
        options.saved && !options.errors.length ? (
          <Notice
            tone="positive"
            title={_('manufacturing_backend.qualityTemplates.saved')}
            message={_('manufacturing_backend.qualityTemplates.savedHelp')}
          />
        ) : null,
        <Section
          title={_('manufacturing_backend.qualityTemplates.criteria')}
          body={stack([
            <Notice
              tone="info"
              title={_('manufacturing_backend.qualityTemplates.rule')}
              message={_('manufacturing_backend.qualityTemplates.ruleHelp')}
            />,
            html`${trustedMarkup(
              renderIsland(
                'backend.ket-grid',
                (props) => backendIslands['backend.ket-grid'].view!(props as never),
                {
                  id: `${QUALITY_TEMPLATE_FORM}-criteria`,
                  config: criteriaGrid(_, record, options.configure),
                },
              ),
            )}`,
          ])}
        />,
        <Section
          title={_('manufacturing_backend.qualityTemplates.general')}
          body={
            options.configure ? (
              <RecordForm
                id={QUALITY_TEMPLATE_FORM}
                action={options.action}
                hidden={{ version: record.version == null ? '' : String(record.version) }}
                fields={[
                  {
                    name: 'name',
                    label: _('manufacturing_backend.field.name'),
                    type: 'text',
                    required: true,
                    value: record.name,
                  },
                  {
                    name: 'productId',
                    label: _('manufacturing_backend.field.product'),
                    type: 'select',
                    value: record.productId ?? '',
                    options: [
                      { value: '', label: _('manufacturing_backend.qualityTemplates.noProduct') },
                      ...options.products,
                    ],
                    help: _('manufacturing_backend.qualityTemplates.productHelp'),
                  },
                  {
                    name: 'active',
                    label: _('manufacturing_backend.qualityTemplates.inUse'),
                    type: 'checkbox',
                    value: record.active ? 'true' : '',
                  },
                ]}
                submit={_('manufacturing_backend.qualityTemplates.save')}
                submitVariant="primary"
              />
            ) : (
              <DescriptionList
                label={_('manufacturing_backend.qualityTemplates.general')}
                items={[
                  { id: 'name', label: _('manufacturing_backend.field.name'), value: record.name },
                  {
                    id: 'product',
                    label: _('manufacturing_backend.field.product'),
                    value:
                      options.products.find((option) => option.value === record.productId)?.label ??
                      record.productId ??
                      _('manufacturing_backend.qualityTemplates.noProduct'),
                  },
                ]}
              />
            )
          }
        />,
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
