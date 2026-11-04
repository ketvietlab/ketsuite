import {
  KET_GRID_NO_CHANGES,
  ActionGroup,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Link,
  LinkButton,
  Notice,
  Stack,
  Surface,
} from '@ketvietlab/design-system'
import type { FieldProps, KetGridIslandConfig, RelationSelectConfig } from '@ketvietlab/design-system'
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
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import { COUNT_REASONS } from '../../stock/count-reasons.ts'
import { settlementForm, settlementInput } from './count-settlement-view.tsx'
import { CountHelp } from '../screens/count-help.tsx'
import { countDetails, countDetailsInput } from './count-details-view.tsx'
import { postedCountLines } from './count-grid-draft.ts'

type Row = Record<string, unknown>
export type CountData = {
  record: Row & { lines: Row[] }
  lang: 'vi' | 'en'
  permissions: Record<string, boolean>
  draftId: string
  links: Record<'shortage' | 'excess', string | null> & { print?: string | null; valuedPrint?: string | null }
  /** Present only for a viewer who may read stock value (K25), once approval booked something. */
  value: { shortage: string | null; excess: string | null; entries: string[] } | null
  choices: Record<'warehouses' | 'products' | 'lots', Row[]> & { people?: Row[] }
  /** Lines carry `pieces` and `piecesEnabled` when the deployment counts some products in pieces. */
  pieces?: boolean
}
export type CountContext = RecordModalContext<CountData>

const TONES: Record<string, 'neutral' | 'positive' | 'warning' | 'danger'> = {
  counting: 'neutral',
  review: 'warning',
  done: 'positive',
  cancel: 'danger',
}

const language = () =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
const t = (c: CountContext, key: string) => c.t(`stock_backend.${key}`)
const state = (c: CountContext) => String(c.data.record.state)
const counting = (c: CountContext) => !c.creating && state(c) === 'counting'
const nameOf = (rows: Row[] | undefined, id: unknown) =>
  String(rows?.find((row) => row.id === id)?.name ?? (id ? String(id) : '—'))
const shown = (value: unknown) => (value == null || value === '' ? '—' : String(value))

const field = (
  c: CountContext,
  name: string,
  label: string,
  props: Partial<FieldProps> = {},
): FieldProps => ({
  id: `count-${c.dialog?.name ?? 'record'}-${name}`,
  name,
  label: t(c, label),
  value: c.draft(name, ''),
  error: c.fieldError(name),
  disabled: c.busy,
  locale: c.data.lang,
  ...props,
})

/** A relation picker of the design system, filled from what the context loaded. */
const relation = (
  c: CountContext,
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
        disabled: Boolean(config.disabled) || c.busy,
      },
    }),
  }
}

const link = (href: string | null, label: unknown) =>
  href ? <Link href={href} label={String(label || '—')} /> : String(label || '—')

/** K62: the products a partial count covers; empty for the whole warehouse. */
const scope = (c: CountContext) => ((c.data.record.productIds as string[] | null) ?? []).map(String)

function summary(c: CountContext) {
  const record = c.data.record
  const value = c.data.value
  const item = (id: string, label: string, content: unknown) =>
    content == null || content === '' ? null : { id, label: t(c, label), value: content as string }
  return (
    <DescriptionList
      items={[
        item('warehouse', 'field.warehouse', nameOf(c.data.choices.warehouses, record.warehouseId)),
        item(
          'scope',
          'count.scope',
          scope(c).length
            ? scope(c)
                .map((id) => nameOf(c.data.choices.products, id))
                .join(', ')
            : t(c, 'count.scopeAll'),
        ),
        item('started', 'count.startedAt', String(record.startedAt ?? '').slice(0, 10)),
        item('blind', 'count.blind', t(c, record.blind ? 'modal.yes' : 'modal.no')),
        item(
          'progress',
          'count.progress',
          `${String(record.countedLines ?? 0)}/${String(record.lineCount ?? 0)}`,
        ),
        item(
          'settlement',
          'count.settlement',
          record.settlementState ? t(c, `count.settlement.${String(record.settlementState)}`) : null,
        ),
        item('differing', 'count.col.differing', shown(record.differingLines)),
        item('submitted', 'count.submittedAt', String(record.submittedAt ?? '').slice(0, 10)),
        item('approved', 'count.approvedAt', String(record.approvedAt ?? '').slice(0, 10)),
        record.shortagePickingId
          ? item(
              'shortage',
              'count.shortageTransfer',
              link(c.data.links.shortage, `${String(record.name)}/XK`),
            )
          : null,
        record.excessPickingId
          ? item('excess', 'count.excessTransfer', link(c.data.links.excess, `${String(record.name)}/NK`))
          : null,
        value?.shortage ? item('shortageValue', 'count.shortageValue', value.shortage) : null,
        value?.excess ? item('excessValue', 'count.excessValue', value.excess) : null,
        value?.entries.length ? item('entries', 'count.entries', value.entries.join(', ')) : null,
        item('returnReason', 'count.returnReason', record.returnReason),
        item('cancelReason', 'count.cancelReason', record.cancelReason),
      ].filter((entry): entry is { id: string; label: string; value: string } => entry !== null)}
    />
  )
}

function lineTable(c: CountContext) {
  const valued = c.data.record.lines.some((line) => line.value)
  return (
    <DataTable
      emptyTitle={t(c, 'count.noLines')}
      emptyMessage={t(c, 'count.noLinesHint')}
      rows={c.data.record.lines}
      id={(row) => String(row.id)}
      responsive="scroll"
      columns={[
        {
          key: 'product',
          label: t(c, 'field.product'),
          cell: (row) =>
            `${nameOf(c.data.choices.products, row.productId)}${
              row.lotId ? ` · ${nameOf(c.data.choices.lots, row.lotId)}` : ''
            }${row.found ? ` · ${t(c, 'count.found')}` : ''}`,
        },
        {
          key: 'expected',
          label: t(c, 'count.expected'),
          kind: 'number',
          cell: (row) => shown(row.expected),
        },
        ...(c.data.pieces
          ? [
              {
                key: 'pieces',
                label: t(c, 'count.pieces'),
                kind: 'number' as const,
                cell: (row: Row) => shown(row.pieces),
              },
            ]
          : []),
        { key: 'counted', label: t(c, 'count.counted'), kind: 'number', cell: (row) => shown(row.counted) },
        ...['qualityGood', 'qualityPoor', 'qualityLost'].map((key) => ({
          key,
          label: t(c, `count.${key}`),
          kind: 'number' as const,
          cell: (row: Row) => shown(row[key]),
        })),
        {
          key: 'difference',
          label: t(c, 'count.difference'),
          kind: 'number',
          cell: (row) => shown(row.difference),
        },
        {
          key: 'reason',
          label: t(c, 'count.lineReason'),
          cell: (row) =>
            [row.reasonCode ? c.t(`stock.countReason.${row.reasonCode}`) : '', row.reason]
              .filter(Boolean)
              .join(' · ') || '—',
        },
        ...(valued
          ? [
              {
                key: 'value',
                label: t(c, 'count.value'),
                kind: 'currency' as const,
                cell: (row: Row) => shown(row.value),
              },
            ]
          : []),
      ]}
    />
  )
}

/** K33 counting is entered in place: one grid for every line, saved at once (DS: editable grids are KetGrid). */
const GRID_FORM = 'stock-count-lines-form'
const countsInGrid = (c: CountContext) => counting(c) && c.data.permissions.saveCountLines === true
const lineName = (c: CountContext, row: Row) =>
  `${nameOf(c.data.choices.products, row.productId)}${row.lotId ? ` · ${nameOf(c.data.choices.lots, row.lotId)}` : ''}${
    row.found ? ` · ${t(c, 'count.found')}` : ''
  }`
const amount = (value: unknown) => (value == null || value === '' ? null : Number(value))

export function countGridConfig(c: CountContext): KetGridIslandConfig {
  // A blind count shows no book, so neither the book nor the difference has a column.
  const book = !c.data.record.blind
  return {
    label: t(c, 'count.lines'),
    ...ketGridLocale(c.data.lang),
    columns: [
      { key: 'product', label: t(c, 'field.product'), type: 'text', editable: false, width: 220, grow: 1 },
      ...(book
        ? [
            {
              key: 'expected',
              label: t(c, 'count.expected'),
              type: 'number' as const,
              editable: false,
              width: 104,
            },
          ]
        : []),
      // Pieces fill the counted quantity on save, on the server and with its rounding; a product
      // not counted in pieces keeps the cell locked.
      ...(c.data.pieces
        ? [
            {
              key: 'pieces',
              label: t(c, 'count.pieces'),
              type: 'number' as const,
              editable: true,
              min: 0,
              width: 96,
              lockedBy: 'piecesLocked',
            },
          ]
        : []),
      ...['counted', 'qualityGood', 'qualityPoor', 'qualityLost'].map((key) => ({
        key,
        label: t(c, `count.${key}`),
        type: 'number' as const,
        editable: true,
        min: 0,
        width: 112,
        sumEquals: {
          fields: ['qualityGood', 'qualityPoor', 'qualityLost'],
          total: 'counted',
          message: c.t('stock.error.countQualityTotal'),
        },
      })),
      ...(book
        ? [
            {
              key: 'difference',
              label: t(c, 'count.difference'),
              type: 'number' as const,
              compute: { difference: ['counted', 'expected'] as const },
              width: 104,
            },
          ]
        : []),
      {
        key: 'reasonCode',
        label: t(c, 'count.lineReason'),
        type: 'select',
        editable: true,
        width: 190,
        options: COUNT_REASONS.map((value) => ({ value, label: c.t(`stock.countReason.${value}`) })),
      },
      { key: 'reason', label: t(c, 'count.reasonNote'), type: 'text', editable: true, width: 180, grow: 1 },
    ],
    rows: c.data.record.lines.map((line) => ({
      id: String(line.id),
      product: lineName(c, line),
      ...(book ? { expected: amount(line.expected) } : {}),
      ...(c.data.pieces ? { pieces: amount(line.pieces), piecesLocked: line.piecesEnabled !== true } : {}),
      counted: amount(line.counted),
      qualityGood: amount(line.qualityGood),
      qualityPoor: amount(line.qualityPoor),
      qualityLost: amount(line.qualityLost),
      reasonCode: String(line.reasonCode ?? ''),
      reason: line.reason == null ? '' : String(line.reason),
    })),
    removable: c.data.permissions.removeCountLine === true,
    readOnly: c.busy,
    visibleRows: 8,
    name: 'lines',
    form: GRID_FORM,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}

function lineGrid(c: CountContext) {
  const error = c.fieldError('lines')
  return (
    <RecordModalForm
      kind={c.kind}
      id={GRID_FORM}
      command="lines"
      fields={[]}
      body={
        <Stack
          items={[
            error ? <Notice tone="danger" title={c.t('recordModal.errorTitle')} message={error} /> : null,
            recordIsland('backend.ket-grid', { id: `stock-count-grid-${c.id}`, config: countGridConfig(c) }),
          ]}
        />
      }
      actions={[<Button type="submit" label={t(c, 'count.saveLines')} variant="primary" disabled={c.busy} />]}
    />
  )
}

function startForm(c: CountContext) {
  return (
    <Surface
      title={t(c, 'count.session')}
      body={
        <RecordModalForm
          kind={c.kind}
          command="start"
          columns={1}
          fields={[
            relation(c, 'warehouseId', 'field.warehouse', c.data.choices.warehouses, { required: true }),
            {
              ...relation(c, 'productIds', 'count.products', c.data.choices.products, {
                multiple: true,
                values: c.draft('productIds', '').split(',').filter(Boolean),
              }),
              help: t(c, 'count.productsHelp'),
            },
            {
              ...field(c, 'blind', 'count.blind', { type: 'checkbox', help: t(c, 'count.blindHelp') }),
              value: c.draftChecked('blind', undefined, true),
            },
          ]}
          actions={[<Button type="submit" label={t(c, 'count.start')} variant="primary" disabled={c.busy} />]}
        />
      }
    />
  )
}

export const countSessionModalDefinition: RecordModalDefinition<CountData> = {
  kind: 'stock.countSession',
  size: 'large',
  // The grid's figures count as unsaved changes, so Send for approval waits for them.
  observeDrafts: ['productId', 'lines', 'committee', 'resolution'],
  labels: () => USER_RECORD_MODAL_LABELS[language()],
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/stock/count-session/${record}/context?lang=${language()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'count.startTitle') : String(c.data.record.name)),
  status: (c) =>
    c.creating ? null : <Badge label={t(c, `count.state.${state(c)}`)} tone={TONES[state(c)] ?? 'neutral'} />,
  body: (c) =>
    c.creating ? (
      <Stack items={[<CountHelp lang={c.data.lang} />, startForm(c)]} />
    ) : (
      <Stack
        items={[
          <CountHelp lang={c.data.lang} />,
          counting(c) && c.data.record.blind ? (
            <Notice tone="info" title={t(c, 'count.blindTitle')} message={t(c, 'count.blindHint')} />
          ) : null,
          counting(c) && c.data.record.returnReason ? (
            <Notice
              tone="warning"
              title={t(c, 'count.returned')}
              message={String(c.data.record.returnReason)}
            />
          ) : null,
          state(c) === 'review' && c.data.permissions.approveCountSession && c.data.record.selfCounted ? (
            <Notice tone="info" title={t(c, 'count.selfTitle')} message={t(c, 'count.selfHint')} />
          ) : null,
          <Surface title={t(c, 'count.session')} body={summary(c)} />,
          countDetails(c),
          <Surface
            title={t(c, 'count.lines')}
            actions={
              counting(c) && c.data.permissions.addCountLine ? (
                <RecordDialogTrigger dialog="add">
                  <Button label={t(c, 'count.add')} variant="secondary" disabled={c.busy} />
                </RecordDialogTrigger>
              ) : null
            }
            body={countsInGrid(c) ? lineGrid(c) : lineTable(c)}
          />,
          state(c) === 'done' &&
          c.data.permissions.settleCountDifference &&
          c.data.record.settlementState !== 'done'
            ? settlementForm(c)
            : null,
        ]}
      />
    ),
  actions: (c) => (
    <ActionGroup
      actions={[
        ...(c.data.links.print ? [<LinkButton href={c.data.links.print} label={t(c, 'count.print')} />] : []),
        ...(c.data.links.valuedPrint
          ? [<LinkButton href={c.data.links.valuedPrint} label={t(c, 'count.valuedPrint')} />]
          : []),
        <Button name="screen-help" type="button" label={t(c, 'replenishment.help')} />,
        ...(counting(c) && c.data.permissions.submitCountSession
          ? [
              <RecordActionForm kind={c.kind} command="submit">
                <Button
                  type="submit"
                  label={t(c, 'count.submit')}
                  variant="primary"
                  // Figures still in the grid would not go for approval: save them first.
                  disabled={c.busy || c.recordChanged}
                />
              </RecordActionForm>,
            ]
          : []),
        ...(state(c) === 'review' && c.data.permissions.approveCountSession && !c.data.record.selfCounted
          ? [
              <RecordActionForm kind={c.kind} command="approve">
                <Button type="submit" label={t(c, 'count.approve')} variant="primary" disabled={c.busy} />
              </RecordActionForm>,
            ]
          : []),
        ...(state(c) === 'review' && c.data.permissions.returnCountSession
          ? [
              <RecordDialogTrigger dialog="return">
                <Button label={t(c, 'count.return')} disabled={c.busy} />
              </RecordDialogTrigger>,
            ]
          : []),
        ...(!c.creating && ['counting', 'review'].includes(state(c)) && c.data.permissions.cancelCountSession
          ? [
              <RecordDialogTrigger dialog="cancel">
                <Button label={t(c, 'count.cancel')} disabled={c.busy} />
              </RecordDialogTrigger>,
            ]
          : []),
      ]}
    />
  ),
  dialogs: {
    add: {
      title: (c) => t(c, 'count.add'),
      view: (c) => {
        const productId = c.draft('productId', '')
        const tracked = c.data.choices.products.find((row) => row.id === productId)?.tracking
        return (
          <RecordModalForm
            kind={c.kind}
            command="add"
            columns={1}
            body={<Notice tone="info" title={t(c, 'count.foundTitle')} message={t(c, 'count.foundHint')} />}
            fields={[
              relation(
                c,
                'productId',
                'field.product',
                scope(c).length
                  ? c.data.choices.products.filter((row) => scope(c).includes(String(row.id)))
                  : c.data.choices.products,
                { required: true },
              ),
              ...(productId && tracked !== 'none'
                ? [
                    relation(
                      c,
                      'lotId',
                      'field.lot',
                      c.data.choices.lots.filter((row) => row.productId === productId),
                      { required: true },
                    ),
                  ]
                : []),
              field(c, 'counted', 'count.counted', { type: 'decimal', required: true }),
              field(c, 'reasonCode', 'count.lineReason', {
                type: 'select',
                options: COUNT_REASONS.map((value) => ({ value, label: c.t(`stock.countReason.${value}`) })),
              }),
              field(c, 'reason', 'count.reasonNote', { type: 'textarea' }),
            ]}
            actions={[<Button type="submit" label={t(c, 'count.add')} variant="primary" disabled={c.busy} />]}
          />
        )
      },
    },
    return: {
      title: (c) => t(c, 'count.return'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="return"
          body={<Notice tone="info" title={t(c, 'count.returnEffect')} message={t(c, 'count.returnHint')} />}
          fields={[field(c, 'reason', 'count.returnReason', { type: 'textarea', required: true })]}
          actions={[
            <Button type="submit" label={t(c, 'count.return')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
    cancel: {
      title: (c) => t(c, 'count.cancel'),
      view: (c) => (
        <RecordModalForm
          kind={c.kind}
          command="cancel"
          body={
            <Notice tone="warning" title={t(c, 'count.cancelEffect')} message={t(c, 'count.cancelHint')} />
          }
          fields={[field(c, 'reason', 'count.cancelReason', { type: 'textarea', required: true })]}
          actions={[
            <Button type="submit" label={t(c, 'count.cancel')} variant="primary" disabled={c.busy} />,
          ]}
        />
      ),
    },
  },
  commands: {
    details: { fn: 'stock.saveCountDetails', after: 'reload', input: countDetailsInput },
    settle: {
      fn: 'stock.settleCountDifference',
      after: 'reload',
      input: settlementInput,
      confirm: (c) => t(c, 'count.settleConfirm'),
    },
    start: {
      fn: 'stock.startCountSession',
      after: 'open',
      input: (form, c) => ({
        id: c.data.draftId,
        warehouseId: String(form.get('warehouseId') ?? ''),
        blind: form.has('blind'),
        productIds: String(form.get('productIds') ?? '')
          .split(',')
          .filter(Boolean),
      }),
    },
    lines: {
      fn: 'stock.saveCountLines',
      after: 'reload',
      // Every refusal shows once, above the grid that posted the lines.
      issueField: () => 'lines',
      input: (form, c) => {
        const posted = postedCountLines(c.data.record.lines, String(form.get('lines') ?? ''))
        return { id: c.id, lines: posted?.lines ?? null, removed: posted?.removed ?? [] }
      },
    },
    add: {
      fn: 'stock.addCountLine',
      after: 'reload',
      input: (form, c) => ({
        id: c.id,
        lineId: c.data.draftId,
        productId: String(form.get('productId') ?? ''),
        lotId: form.get('lotId') ? String(form.get('lotId')) : null,
        counted: String(form.get('counted') ?? ''),
        reason: String(form.get('reason') ?? ''),
        reasonCode: String(form.get('reasonCode') ?? ''),
      }),
    },
    submit: {
      fn: 'stock.submitCountSession',
      after: 'reload',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'count.confirmSubmit'),
    },
    approve: {
      fn: 'stock.approveCountSession',
      after: 'reload',
      input: (_form, c) => ({ id: c.id }),
      confirm: (c) => t(c, 'count.confirmApprove'),
    },
    return: {
      fn: 'stock.returnCountSession',
      after: 'reload',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
    },
    cancel: {
      fn: 'stock.cancelCountSession',
      after: 'reload',
      input: (form, c) => ({ id: c.id, reason: String(form.get('reason') ?? '') }),
    },
  },
}

export const countSessionModal = createRecordModal(countSessionModalDefinition)
