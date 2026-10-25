// A unit of measure's record modal (`record=product.uom:<id>`), opened from the Units of
// measure list (units/island.tsx). A unit is a reference unit or counts a quantity of
// another unit; the read is `product_backend.unitContext` (units.ts, `unitModalData`) and
// the save goes through the screen's route (`/admin/product/uoms/command`), which turns
// the form into `uom.saveUnit` and the refusals into the viewer's words.
import { marked } from 'marked'
import {
  AppSwitcherHelp,
  Button,
  DescriptionList,
  Field,
  HelpDrawer,
  MarkdownContent,
  Notice,
  RecordActions,
  Section,
  Stack,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import {
  RecordCloseTrigger,
  RecordModalForm,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'
import { UNIT_COMMAND_PATH, typedQuantity } from '../units.ts'
import type { UnitModalData } from '../units.ts'
import { HELP } from '../screens/help-words.ts'
import { unitsHelp } from '../units/help.ts'
import { UNIT_RECORD_MODAL_LABELS } from '../units/labels.ts'

type Context = RecordModalContext<UnitModalData>
const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const formId = 'product-uom-form'
const t = (c: Context, key: string, params?: Record<string, unknown>): string =>
  c.t(`product_backend.uom.${key}`, params)
const number = (c: Context, value: number | string): string =>
  new Intl.NumberFormat(c.data.lang === 'en' ? 'en-GB' : 'vi-VN', { maximumFractionDigits: 3 }).format(
    Number(value),
  )

// The reference being chosen names the quantity's unit, so the select feeds view state.
const referenceOf = (c: Context): string =>
  c.state('referenceId', c.draft('referenceId', c.data.record.referenceId))
const referenceName = (c: Context): string =>
  c.data.references.find((row) => row.value === referenceOf(c))?.label.split(' · ')[0] ?? ''
const helpId = (id: string, help: string | null, error: string | null): string | null =>
  [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || null

const form = (c: Context): JSXChild => {
  const { record, usage } = c.data
  const locked = usage.locked
  const chosen = referenceOf(c)
  const referenceHelp = locked ? null : t(c, 'referenceHelp')
  const referenceError = c.fieldError('referenceId')
  const options = [{ value: '', label: t(c, 'referenceNone') }, ...c.data.references]
  return (
    <RecordModalForm
      kind={c.kind}
      id={formId}
      command="save"
      // Disabled controls are not submitted: a fixed conversion travels as its saved value.
      hidden={locked ? { referenceId: record.referenceId, factor: record.factor } : {}}
      fields={[]}
      body={
        <Stack
          items={[
            <Field
              id="product-uom-name"
              name="name"
              label={t(c, 'field.name')}
              required
              maxLength={40}
              help={t(c, 'nameHelp')}
              value={c.draft('name', record.name)}
              error={c.fieldError('name')}
              disabled={c.busy}
            />,
            <Field
              id="product-uom-reference"
              name="referenceId"
              label={t(c, 'field.reference')}
              type="select"
              help={referenceHelp}
              error={referenceError}
              disabled={c.busy || locked}
              value={chosen}
              control={recordStateSelectControl({
                id: 'product-uom-reference',
                name: 'referenceId',
                state: 'referenceId',
                value: chosen,
                options,
                disabled: c.busy || locked,
                invalid: Boolean(referenceError),
                describedBy: helpId('product-uom-reference', referenceHelp, referenceError),
              })}
            />,
            // A reference unit has no quantity: the field leaves rather than standing empty in the gap.
            ...(chosen
              ? [
                  <Field
                    id="product-uom-factor"
                    name="factor"
                    label={t(c, 'field.factor')}
                    required
                    inputMode="decimal"
                    align="end"
                    maxLength={12}
                    suffix={referenceName(c)}
                    help={t(c, 'factorHelp', { reference: referenceName(c) })}
                    value={c.draft('factor', typedQuantity(record.factor, c.data.lang))}
                    error={c.fieldError('factor')}
                    disabled={c.busy || locked}
                  />,
                ]
              : []),
            <Field
              id="product-uom-active"
              name="active"
              label={t(c, 'field.active')}
              type="checkbox"
              submitValue="1"
              help={t(c, 'activeHelp')}
              checked={c.draftChecked('active', '1', record.active)}
              error={c.fieldError('active')}
              disabled={c.busy}
            />,
          ]}
        />
      }
    />
  )
}

const facts = (c: Context): JSXChild => (
  <Section
    title={t(c, 'facts')}
    body={
      <DescriptionList
        columns={1}
        items={[
          ...(c.data.conversion
            ? [
                {
                  id: 'root',
                  label: t(c, 'factRoot'),
                  value: `${number(c, c.data.conversion.quantity)} ${c.data.conversion.root}`,
                },
              ]
            : []),
          { id: 'products', label: t(c, 'factProducts'), value: number(c, c.data.usage.products) },
          { id: 'packagings', label: t(c, 'factPackagings'), value: number(c, c.data.usage.packagings) },
          {
            id: 'derived',
            label: t(c, 'factDerived'),
            value: c.data.derived.length ? c.data.derived.join(', ') : t(c, 'none'),
          },
        ]}
      />
    }
  />
)

// The screen's guide travels with the record: Help in the modal opens it inside the modal.
const HELP_ID = 'product-uom-record-help'
const guide = (c: Context): JSXChild => {
  const words = HELP[c.data.lang]
  const help = unitsHelp[c.data.lang]
  return (
    <HelpDrawer
      id={HELP_ID}
      label={words.label}
      title={help.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={help.source}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: words.diagram,
            table: words.table,
            source: words.source,
            loading: words.loading,
            error: words.error,
          }}
        />
      }
    />
  )
}

const readonly = (c: Context): JSXChild => (
  <DescriptionList
    columns={1}
    items={[
      { id: 'name', label: t(c, 'field.name'), value: c.data.record.name },
      {
        id: 'reference',
        label: t(c, 'field.reference'),
        value:
          c.data.references.find((row) => row.value === c.data.record.referenceId)?.label ??
          t(c, 'referenceNone'),
      },
      ...(c.data.record.referenceId
        ? [{ id: 'factor', label: t(c, 'field.factor'), value: number(c, c.data.record.factor) }]
        : []),
      { id: 'active', label: t(c, 'field.active'), value: c.data.record.active ? t(c, 'yes') : t(c, 'no') },
    ]}
  />
)

export const uomModalDefinition: RecordModalDefinition<UnitModalData> = {
  kind: 'product.uom',
  labels: () => UNIT_RECORD_MODAL_LABELS[pageLang()],
  size: 'small',
  context: {
    fn: 'product_backend.unitContext',
    input: (id, creating) => ({ ...(creating ? {} : { id }), locale: pageLang() }),
  },
  title: (c) => (c.creating ? t(c, 'createTitle') : c.data.editable ? t(c, 'editTitle') : t(c, 'viewTitle')),
  body: (c) => (
    <>
      <Stack
        items={[
          ...(c.data.usage.locked
            ? [<Notice tone="info" title={t(c, 'lockedTitle')} message={t(c, 'lockedHelp')} />]
            : []),
          c.data.editable ? form(c) : readonly(c),
          ...(c.creating ? [] : [facts(c)]),
        ]}
      />
      {guide(c)}
    </>
  ),
  // Help, then the way out, then the one command: the decision reads left to right.
  actions: (c) => (
    <RecordActions
      actions={[
        <AppSwitcherHelp label={HELP[c.data.lang].trigger} />,
        <RecordCloseTrigger>
          <Button label={c.data.editable ? t(c, 'cancel') : c.t('recordModal.close')} variant="secondary" />
        </RecordCloseTrigger>,
        ...(c.data.editable
          ? [
              <Button
                type="submit"
                form={formId}
                label={c.creating ? t(c, 'create') : t(c, 'save')}
                variant="primary"
                loading={c.busy}
              />,
            ]
          : []),
      ]}
    />
  ),
  commands: {
    save: {
      route: UNIT_COMMAND_PATH,
      input: (form, c) => ({
        id: c.creating ? null : c.id,
        name: String(form.get('name') ?? ''),
        referenceId: String(form.get('referenceId') ?? ''),
        factor: String(form.get('factor') ?? ''),
        active: form.has('active'),
      }),
      after: 'close',
    },
  },
}

export const uomModal = createRecordModal(uomModalDefinition)
