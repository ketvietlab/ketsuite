import {
  ActionGroup,
  AppSwitcherHelp,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
} from '../../../ui/client/record-modal-form.tsx'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { BOM_FORM, linesGrid, operationsGrid, postedRows } from './bom-grid.tsx'

type Row = Record<string, unknown>
export type BomData = {
  record: Row
  lang: 'vi' | 'en'
  draftId: string
  can: {
    save: boolean
    submit: boolean
    approve: boolean
    reject: boolean
    newVersion: boolean
    archive: boolean
    products: boolean
  }
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<BomData>

export const CONSUMPTION = ['flexible', 'warning', 'strict'] as const
const STATE_TONE: Record<string, 'neutral' | 'warning' | 'positive'> = {
  draft: 'neutral',
  review: 'warning',
  active: 'positive',
  archived: 'neutral',
}
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi')
const t = (c: Context, key: string, params?: Record<string, string>) =>
  c.t(`manufacturing_backend.${key}`, params)
const nameOf = (rows: Row[] | undefined, id: unknown, label = 'name') => {
  const row = rows?.find((candidate) => candidate.id === id)
  return row ? String(row[label] ?? row.name) : String(id ?? '—')
}
const title = (c: Context) =>
  `${String(c.data.record.familyCode ?? nameOf(c.data.choices.products, c.data.record.productId, 'displayName'))} · ${t(c, 'bom.version', { version: String(c.data.record.version) })}`

const settingsFields = (c: Context): FieldProps[] => {
  const record = c.data.record
  const disabled = c.busy || !c.data.can.save
  const select = (name: string, value: string, choices: { value: string; label: string }[]): FieldProps => ({
    id: `manufacturing-bom-${name}`,
    name,
    label: t(c, `field.${name === 'productId' ? 'product' : name === 'productUomId' ? 'uom' : name}`),
    type: 'select',
    value: c.draft(name, value),
    options: choices,
    error: c.fieldError(name),
    disabled,
  })
  // Only the first version names the family; later ones take its code when approved.
  const ownsCode = !record.familyId || record.familyId === record.id
  return [
    ...(ownsCode
      ? [
          {
            id: 'manufacturing-bom-code',
            name: 'code',
            label: t(c, 'field.code'),
            value: c.draft('code', String(record.code ?? '')),
            error: c.fieldError('code'),
            disabled,
          },
        ]
      : []),
    select(
      'productId',
      String(record.productId ?? ''),
      (c.data.choices.products ?? []).map((row) => ({
        value: String(row.id),
        label: String(row.displayName ?? row.name),
      })),
    ),
    {
      id: 'manufacturing-bom-productQty',
      name: 'productQty',
      label: t(c, 'field.batch'),
      type: 'decimal',
      required: true,
      value: c.draft('productQty', String(record.productQty ?? '1')),
      error: c.fieldError('productQty'),
      disabled,
    },
    select(
      'productUomId',
      String(record.productUomId ?? ''),
      (c.data.choices.units ?? []).map((row) => ({ value: String(row.id), label: String(row.name) })),
    ),
    select(
      'consumption',
      String(record.consumption ?? 'flexible'),
      CONSUMPTION.map((value) => ({ value, label: t(c, `consumption.${value}`) })),
    ),
    // With a unit weight, each batch of output is weighed and must fall within the tolerance.
    {
      id: 'manufacturing-bom-unitWeight',
      name: 'unitWeight',
      label: t(c, 'field.unitWeight'),
      type: 'decimal',
      value: c.draft('unitWeight', String(record.unitWeight ?? '')),
      error: c.fieldError('unitWeight'),
      help: t(c, 'bom.unitWeightHelp'),
      disabled,
    },
    {
      id: 'manufacturing-bom-weightTolerance',
      name: 'weightTolerance',
      label: t(c, 'field.weightTolerance'),
      type: 'decimal',
      value: c.draft('weightTolerance', String(record.weightTolerance ?? '')),
      error: c.fieldError('weightTolerance'),
      disabled,
    },
    // Confirming a sale of the product drafts an order for each line (P12).
    {
      id: 'manufacturing-bom-toOrder',
      name: 'toOrder',
      label: t(c, 'field.toOrder'),
      type: 'checkbox',
      value: c.draft('toOrder', record.toOrder === true ? '1' : '') === '1',
      help: t(c, 'bom.toOrderHelp'),
      error: c.fieldError('toOrder'),
      disabled,
    },
    // With a pH range, each lot of output waits in quarantine until its quality check passes.
    {
      id: 'manufacturing-bom-phMin',
      name: 'phMin',
      label: t(c, 'field.phMin'),
      type: 'decimal',
      value: c.draft('phMin', String(record.phMin ?? '')),
      error: c.fieldError('phMin'),
      help: t(c, 'bom.phHelp'),
      disabled,
    },
    {
      id: 'manufacturing-bom-phMax',
      name: 'phMax',
      label: t(c, 'field.phMax'),
      type: 'decimal',
      value: c.draft('phMax', String(record.phMax ?? '')),
      error: c.fieldError('phMax'),
      disabled,
    },
  ]
}

const settings = (c: Context) =>
  c.data.can.save ? (
    <RecordModalForm id={BOM_FORM} kind={c.kind} command="save" columns={2} fields={settingsFields(c)} />
  ) : (
    <DescriptionList
      items={settingsFields(c).map((field) => ({
        id: String(field.name),
        label: String(field.label),
        value:
          field.options?.find((option) => option.value === field.value)?.label ?? String(field.value || '—'),
      }))}
    />
  )

const readOnlyRows = (c: Context, kind: 'operations' | 'lines') =>
  kind === 'operations' ? (
    <DataTable
      rows={(c.data.record.operations as Row[]) ?? []}
      id={(row) => String(row.id)}
      responsive="scroll"
      columns={[
        { key: 'name', label: t(c, 'field.operation'), cell: (row) => String(row.name) },
        {
          key: 'workCenter',
          label: t(c, 'field.workCenter'),
          cell: (row) => nameOf(c.data.choices.workCenters, row.workCenterId),
        },
        {
          key: 'minutes',
          label: t(c, 'field.minutes'),
          kind: 'number',
          cell: (row) => String(row.durationExpected),
        },
        {
          key: 'timeMode',
          label: t(c, 'field.timeMode'),
          cell: (row) => t(c, `timeMode.${String(row.timeMode ?? 'fixed')}`),
        },
      ]}
    />
  ) : (
    <DataTable
      rows={(c.data.record.lines as Row[]) ?? []}
      id={(row) => String(row.id)}
      responsive="scroll"
      columns={[
        {
          key: 'product',
          label: t(c, 'field.component'),
          cell: (row) => nameOf(c.data.choices.products, row.productId, 'displayName'),
        },
        {
          key: 'quantity',
          label: t(c, 'field.quantity'),
          kind: 'number',
          cell: (row) => String(row.productQty),
        },
        {
          key: 'uom',
          label: t(c, 'field.uom'),
          cell: (row) => nameOf(c.data.choices.units, row.productUomId),
        },
        {
          key: 'loss',
          label: t(c, 'field.loss'),
          kind: 'number',
          cell: (row) => String(row.lossPercent ?? 0),
        },
        {
          key: 'operation',
          label: t(c, 'field.operation'),
          cell: (row) => (row.operationId ? nameOf(c.data.record.operations as Row[], row.operationId) : '—'),
        },
      ]}
    />
  )

const reasonForm = (c: Context, command: string, help: string) => (
  <RecordModalForm
    id={`manufacturing-bom-${command}-form`}
    kind={c.kind}
    command={command}
    fields={[
      {
        id: `manufacturing-bom-${command}-reason`,
        name: 'reason',
        label: t(c, 'field.reason'),
        type: 'textarea',
        required: true,
        help,
        value: c.draft('reason', ''),
        error: c.fieldError('reason'),
        disabled: c.busy,
      },
    ]}
  />
)
const confirmForm = (c: Context, command: string, title: string, message: string) => (
  <Stack
    items={[
      <Notice tone="info" title={title} message={message} />,
      <RecordModalForm
        id={`manufacturing-bom-${command}-form`}
        kind={c.kind}
        command={command}
        fields={[]}
      />,
    ]}
  />
)
const submitButton = (
  c: Context,
  command: string,
  label: string,
  variant: 'primary' | 'destructive' = 'primary',
) => (
  <Button
    type="submit"
    form={`manufacturing-bom-${command}-form`}
    label={label}
    variant={variant}
    loading={c.busy}
  />
)
const dialogButton = (dialog: string, label: string, variant: 'primary' | 'secondary' = 'secondary') => (
  <RecordDialogTrigger dialog={dialog}>
    <Button label={label} variant={variant} />
  </RecordDialogTrigger>
)

export const bomDefinition: RecordModalDefinition<BomData> = {
  kind: 'manufacturing.bom',
  size: 'large',
  labels: () => USER_RECORD_MODAL_LABELS[lang()],
  context: {
    route: (id) => `/admin/manufacturing/boms/${encodeURIComponent(id)}/context?lang=${lang()}`,
    query: ['company', 'branch'],
  },
  title,
  status: (c) => (
    <Badge
      label={t(c, `bomState.${String(c.data.record.state)}`)}
      tone={STATE_TONE[String(c.data.record.state)] ?? 'neutral'}
    />
  ),
  pageActions: (c) => (
    <ActionGroup
      actions={[
        <RecordCloseTrigger>
          <Button label={t(c, 'action.back')} variant="secondary" />
        </RecordCloseTrigger>,
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        ...(c.data.can.archive ? [dialogButton('archive', t(c, 'action.archive'))] : []),
        ...(c.data.can.reject ? [dialogButton('reject', t(c, 'bom.reject'))] : []),
        ...(c.data.can.newVersion ? [dialogButton('newVersion', t(c, 'bom.newVersion'))] : []),
        ...(c.data.can.submit ? [dialogButton('submit', t(c, 'bom.submit'))] : []),
        ...(c.data.can.approve ? [dialogButton('approve', t(c, 'bom.approve'), 'primary')] : []),
        ...(c.data.can.save
          ? [
              <Button
                type="submit"
                form={BOM_FORM}
                label={t(c, 'action.save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  pageAsideBreakpoint: 'wide',
  pageAsideWhenStacked: 'after',
  pageAsideLabel: (c) => t(c, 'bom.versions'),
  pageAside: (c) => (
    <Surface
      title={t(c, 'bom.versions')}
      body={
        <DataTable
          rows={(c.data.record.versions as Row[]) ?? []}
          id={(row) => String(row.id)}
          rowHref={(row) =>
            `/admin/manufacturing/boms/${encodeURIComponent(String(row.id))}?lang=${c.data.lang}`
          }
          columns={[
            { key: 'version', label: t(c, 'field.version'), cell: (row) => `v${String(row.version)}` },
            {
              key: 'state',
              label: t(c, 'field.state'),
              cell: (row) => (
                <Badge
                  label={t(c, `bomState.${String(row.state)}`)}
                  tone={STATE_TONE[String(row.state)] ?? 'neutral'}
                />
              ),
            },
            { key: 'reason', label: t(c, 'field.reason'), cell: (row) => String(row.reason ?? '—') },
          ]}
        />
      }
    />
  ),
  body: (c) => (
    <Stack
      items={[
        c.data.record.state === 'draft' && c.data.record.reason ? (
          <Notice tone="warning" title={t(c, 'bom.returned')} message={String(c.data.record.reason)} />
        ) : null,
        c.data.record.state === 'review' ? (
          <Notice tone="info" title={t(c, 'bom.inReview')} message={String(c.data.record.reason ?? '')} />
        ) : null,
        <Surface title={t(c, 'bom.settings')} body={settings(c)} />,
        <Surface
          title={t(c, 'bom.operations')}
          body={
            c.data.can.save
              ? recordIsland('backend.ket-grid', {
                  id: 'manufacturing-bom-operations',
                  config: operationsGrid(c),
                })
              : readOnlyRows(c, 'operations')
          }
        />,
        <Surface
          title={t(c, 'bom.lines')}
          body={
            c.data.can.save
              ? recordIsland('backend.ket-grid', { id: 'manufacturing-bom-lines', config: linesGrid(c) })
              : readOnlyRows(c, 'lines')
          }
        />,
      ]}
    />
  ),
  dialogs: {
    submit: {
      title: (c) => t(c, 'bom.submit'),
      view: (c) => reasonForm(c, 'submit', t(c, 'bom.submitHelp')),
      actions: (c) => submitButton(c, 'submit', t(c, 'bom.submit')),
    },
    reject: {
      title: (c) => t(c, 'bom.reject'),
      view: (c) => reasonForm(c, 'reject', t(c, 'bom.rejectHelp')),
      actions: (c) => submitButton(c, 'reject', t(c, 'bom.reject')),
    },
    approve: {
      title: (c) => t(c, 'bom.approve'),
      view: (c) => confirmForm(c, 'approve', t(c, 'bom.approve'), t(c, 'bom.approveHelp')),
      actions: (c) => submitButton(c, 'approve', t(c, 'bom.approve')),
    },
    newVersion: {
      title: (c) => t(c, 'bom.newVersion'),
      view: (c) => confirmForm(c, 'newVersion', t(c, 'bom.newVersion'), t(c, 'bom.newVersionHelp')),
      actions: (c) => submitButton(c, 'newVersion', t(c, 'bom.newVersion')),
    },
    archive: {
      title: (c) => t(c, 'action.archive'),
      view: (c) => confirmForm(c, 'archive', t(c, 'action.archive'), t(c, 'bom.archiveHelp')),
      actions: (c) => submitButton(c, 'archive', t(c, 'action.archive'), 'destructive'),
    },
  },
  commands: {
    save: {
      route: '/admin/manufacturing/boms/record-command',
      input: (form, c) => ({
        id: c.id,
        code: String(form.get('code') ?? c.data.record.code ?? ''),
        productId: String(form.get('productId') ?? ''),
        productQty: String(form.get('productQty') ?? ''),
        productUomId: String(form.get('productUomId') ?? ''),
        consumption: String(form.get('consumption') ?? ''),
        unitWeight: String(form.get('unitWeight') ?? ''),
        weightTolerance: String(form.get('weightTolerance') ?? ''),
        phMin: String(form.get('phMin') ?? ''),
        phMax: String(form.get('phMax') ?? ''),
        toOrder: form.get('toOrder') ? '1' : '',
        operations: JSON.stringify(
          postedRows(
            form.get('operations') as string | null,
            (c.data.record.operations as Row[]) ?? [],
            c.id,
          ),
        ),
        lines: JSON.stringify(
          postedRows(form.get('lines') as string | null, (c.data.record.lines as Row[]) ?? [], c.id),
        ),
      }),
      clearRecordDrafts: ['operations', 'lines'],
      after: 'reload',
    },
    submit: {
      fn: 'manufacturing.submitBom',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
    reject: {
      fn: 'manufacturing.rejectBom',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
      after: 'reload',
    },
    approve: { fn: 'manufacturing.approveBom', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    archive: { fn: 'manufacturing.archiveBom', input: (_form, c) => ({ id: c.id }), after: 'reload' },
    newVersion: {
      fn: 'manufacturing.newBomVersion',
      input: (_form, c) => ({ id: c.id, newId: c.data.draftId }),
      navigate: (value, c) =>
        `/admin/manufacturing/boms/${encodeURIComponent(String((value as Row).id))}?lang=${c.data.lang}`,
    },
  },
}

export const bomPage = createRecordPage(bomDefinition, {
  path: (id) => `/admin/manufacturing/boms/${encodeURIComponent(id)}`,
})
