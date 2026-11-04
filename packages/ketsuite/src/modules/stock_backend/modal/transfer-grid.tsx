import { Button, KET_GRID_NO_CHANGES, Notice, Stack } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import { heldLineValues } from './transfer-grid-draft.ts'

type Row = Record<string, unknown>
type Data = {
  record: Row & { moves: Row[] }
  permissions: Record<string, boolean>
  valuation?: { drafts: Array<{ moveLineId: string; unitCost: string | null }> } | null
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<Data>
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)

/** Transfer lines are entered in one grid (DS: editable rows are a KetGrid), saved at once. */
export const PICKING_GRID_FORM = 'stock-transfer-lines-form'

/** Whether this reader edits the transfer's lines in the grid: an open transfer and some line right. */
export const linesInGrid = (c: Context) =>
  !['done', 'cancel'].includes(String(c.data.record.state)) &&
  c.data.permissions.savePickingLines === true &&
  ['saveMoveLine', 'prepareReceiptLot', 'setReceiptUnitCost'].some((fn) => c.data.permissions[fn] === true)

export function pickingGridConfig(c: Context): KetGridIslandConfig {
  const moves = c.data.record.moves
  const allowed = c.data.permissions
  const receipts = moves.some((move) => move.receiptLotInput === true)
  const plain = moves.some((move) => move.receiptLotInput !== true)
  // K24: a manager prices a receipt's lines before it completes.
  const priced =
    Boolean(c.data.valuation) &&
    allowed.setReceiptUnitCost === true &&
    moves.some((move) => move.valuedReceipt === true)
  // Which cells a row takes follows its move: a lot-tracked receipt names its lot, other lines pick one.
  const flags = (move: Row) => {
    const receipt = move.receiptLotInput === true
    const lineLocked = allowed[receipt ? 'prepareReceiptLot' : 'saveMoveLine'] !== true
    return {
      lineLocked,
      lotLocked: lineLocked || receipt,
      receiptLocked: lineLocked || !receipt,
      costLocked: !priced || move.valuedReceipt !== true,
    }
  }
  const lots = c.data.choices.lots ?? []
  return {
    label: t(c, 'modal.picked'),
    ...ketGridLocale(typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'),
    columns: [
      {
        key: 'moveId',
        label: t(c, 'field.product'),
        type: 'select',
        editable: true,
        required: true,
        // A saved line keeps its product; a new one takes the cells its move allows.
        lockedBy: 'saved',
        options: moves.map((move) => ({ value: String(move.id), label: String(move.name) })),
        sets: Object.fromEntries(moves.map((move) => [String(move.id), flags(move)])),
        resets: ['lotId'],
        width: 220,
        grow: 1,
      },
      {
        key: 'quantity',
        label: t(c, 'modal.quantity'),
        type: 'number',
        editable: true,
        lockedBy: 'lineLocked',
        min: 0,
        width: 104,
      },
      ...(plain
        ? [
            {
              key: 'lotId',
              label: t(c, 'field.lot'),
              type: 'select' as const,
              editable: true,
              lockedBy: 'lotLocked',
              options: lots.map((lot) => ({ value: String(lot.id), label: String(lot.name) })),
              optionsBy: {
                field: 'moveId',
                values: Object.fromEntries(
                  moves.map((move) => [
                    String(move.id),
                    lots.filter((lot) => lot.productId === move.productId).map((lot) => String(lot.id)),
                  ]),
                ),
              },
              width: 160,
            },
          ]
        : []),
      ...(receipts
        ? [
            {
              key: 'name',
              label: t(c, 'modal.receiptLotName'),
              type: 'text' as const,
              editable: true,
              lockedBy: 'receiptLocked',
              placeholder: t(c, 'modal.receiptAutomatic'),
              width: 160,
            },
            {
              key: 'expirationDate',
              label: t(c, 'modal.receiptExpiry'),
              type: 'date' as const,
              editable: true,
              lockedBy: 'receiptLocked',
              placeholder: t(c, 'modal.receiptDefaultExpiry'),
              width: 140,
            },
          ]
        : []),
      {
        key: 'picked',
        label: t(c, 'modal.picked'),
        type: 'checkbox',
        editable: true,
        lockedBy: 'lineLocked',
        width: 104,
      },
      ...(priced
        ? [
            {
              key: 'unitCost',
              label: t(c, 'modal.unitCost'),
              type: 'number' as const,
              editable: true,
              lockedBy: 'costLocked',
              min: 0,
              placeholder: t(c, 'modal.averageCost'),
              hint: t(c, 'modal.unitCostHint'),
              width: 140,
            },
          ]
        : []),
    ],
    rows: moves.flatMap((move) =>
      ((move.lines as Row[] | undefined) ?? []).map((line) => {
        const draft = c.data.valuation?.drafts.find((row) => row.moveLineId === line.id)
        return {
          id: String(line.id),
          ...heldLineValues(line),
          saved: true,
          ...flags(move),
          ...(priced ? { unitCost: draft?.unitCost == null ? null : Number(draft.unitCost) } : {}),
        }
      }),
    ),
    newRows: moves.some((move) => !flags(move).lineLocked)
      ? [
          {
            label: t(c, 'modal.addLine'),
            row: {
              moveId: null,
              quantity: 1,
              lotId: null,
              name: '',
              expirationDate: null,
              picked: true,
              saved: false,
              lineLocked: true,
              lotLocked: true,
              receiptLocked: true,
              costLocked: true,
            },
          },
        ]
      : [],
    removable: false,
    readOnly: c.busy,
    visibleRows: 8,
    name: 'lines',
    form: PICKING_GRID_FORM,
    carry: c.draft('lines', KET_GRID_NO_CHANGES),
  }
}

export const PickingLineGrid = ({ context: c }: { context: Context }) => {
  const error = c.fieldError('lines')
  return (
    <RecordModalForm
      kind={c.kind}
      id={PICKING_GRID_FORM}
      command="lines"
      fields={[]}
      body={
        <Stack
          items={[
            error ? <Notice tone="danger" title={c.t('recordModal.errorTitle')} message={error} /> : null,
            // K30: a receipt line only names its lot; lots and stock are written when the receipt completes.
            c.data.record.moves.some((move) => move.receiptLotInput === true) ? (
              <Notice title={t(c, 'modal.receiptPending')} message={t(c, 'modal.receiptHint')} />
            ) : null,
            recordIsland('backend.ket-grid', {
              id: `stock-transfer-grid-${c.id}`,
              config: pickingGridConfig(c),
            }),
          ]}
        />
      }
      actions={[<Button type="submit" label={t(c, 'modal.saveLines')} variant="primary" disabled={c.busy} />]}
    />
  )
}
