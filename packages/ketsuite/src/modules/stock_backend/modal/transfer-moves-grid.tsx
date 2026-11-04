import { Button, KET_GRID_NO_CHANGES, Notice, Stack } from '@ketvietlab/design-system'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { recordIsland } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'

type Row = Record<string, unknown>
type Data = {
  record: Row & { moves: Row[] }
  permissions: Record<string, boolean>
  choices: Record<string, Row[]>
}
type Context = RecordModalContext<Data>
const t = (c: Context, key: string) => c.t(`stock_backend.${key}`)
/** The unit tree a unit belongs to: units of one tree convert into each other. */
const rootOf = (unit: Row | undefined) =>
  String(unit?.parentPath ?? '')
    .split('/')
    .filter(Boolean)[0] ?? ''

/** The transfer's products are added in one grid (DS: document lines are a KetGrid), saved at once. */
export const MOVES_GRID_FORM = 'stock-transfer-moves-form'

/** Whether this reader adds the transfer's products in the grid: an open transfer and both functions. */
export const movesInGrid = (c: Context) =>
  !c.creating &&
  !['done', 'cancel'].includes(String(c.data.record.state)) &&
  c.data.permissions.addMoves === true &&
  c.data.permissions.addMove === true

/** A sales delivery's products are the order's and a return's the delivery's (K21): the grid only reads. */
const movesLocked = (c: Context) => c.data.record.bound === true

export function movesGridConfig(c: Context): KetGridIslandConfig {
  const products = c.data.choices.products ?? []
  const units = c.data.choices.units ?? []
  const unitById = new Map(units.map((unit) => [String(unit.id), unit]))
  // Saved moves keep their product even when it is no longer offered for new lines.
  const productOptions = new Map<string, string>(
    c.data.record.moves.map((move) => [String(move.productId), String(move.name)]),
  )
  for (const product of products) productOptions.set(String(product.id), String(product.name))
  return {
    label: t(c, 'modal.products'),
    ...ketGridLocale(typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'),
    columns: [
      {
        key: 'productId',
        label: t(c, 'field.product'),
        type: 'select',
        editable: true,
        required: true,
        // A saved product line stays as it is; a new one takes the product's own unit.
        lockedBy: 'saved',
        options: [...productOptions].map(([value, label]) => ({ value, label })),
        sets: Object.fromEntries(
          products.map((product) => [String(product.id), { productUomId: product.uomId ?? null }]),
        ),
        width: 240,
        grow: 1,
      },
      {
        key: 'productUomId',
        label: t(c, 'field.uom'),
        type: 'select',
        editable: true,
        required: true,
        lockedBy: 'saved',
        options: units.map((unit) => ({ value: String(unit.id), label: String(unit.name) })),
        // A product takes the units its own unit converts into.
        optionsBy: {
          field: 'productId',
          values: Object.fromEntries(
            products.map((product) => {
              const root = rootOf(unitById.get(String(product.uomId)))
              return [
                String(product.id),
                units.filter((unit) => root && rootOf(unit) === root).map((unit) => String(unit.id)),
              ]
            }),
          ),
        },
        width: 140,
      },
      {
        key: 'productUomQty',
        label: t(c, 'modal.demand'),
        type: 'number',
        editable: true,
        required: true,
        lockedBy: 'saved',
        min: 0,
        width: 112,
      },
      // What the move's picked lines hold against its demand, as the mock's Đã làm
      // (C23 R3): a delivery may ship more than ordered.
      ...(c.data.record.state === 'draft'
        ? []
        : [{ key: 'done', label: t(c, 'modal.done'), type: 'number' as const, editable: false, width: 112 }]),
      { key: 'state', label: t(c, 'transfer.list.col.state'), type: 'text', editable: false, width: 140 },
    ],
    rows: c.data.record.moves.map((move) => ({
      id: String(move.id),
      productId: String(move.productId),
      productUomId: move.productUomId == null ? null : String(move.productUomId),
      productUomQty:
        move.productUomQty == null || move.productUomQty === '' ? null : Number(move.productUomQty),
      done: ((move.lines as Row[] | undefined) ?? []).reduce(
        (sum, line) => sum + Number(line.quantity ?? 0),
        0,
      ),
      state: t(c, `state.${String(move.state)}`),
      saved: true,
    })),
    newRows: movesLocked(c)
      ? []
      : [
          {
            label: t(c, 'modal.addProduct'),
            row: { productId: null, productUomId: null, productUomQty: 1, state: '', saved: false },
          },
        ],
    removable: false,
    readOnly: c.busy || movesLocked(c),
    visibleRows: 8,
    name: 'moves',
    form: MOVES_GRID_FORM,
    carry: c.draft('moves', KET_GRID_NO_CHANGES),
  }
}

export const TransferMovesGrid = ({ context: c }: { context: Context }) => {
  const error = c.fieldError('moves')
  if (movesLocked(c))
    return recordIsland('backend.ket-grid', {
      id: `stock-transfer-moves-${c.id}`,
      config: movesGridConfig(c),
    })
  return (
    <RecordModalForm
      kind={c.kind}
      id={MOVES_GRID_FORM}
      command="moves"
      fields={[]}
      body={
        <Stack
          items={[
            error ? <Notice tone="danger" title={c.t('recordModal.errorTitle')} message={error} /> : null,
            recordIsland('backend.ket-grid', {
              id: `stock-transfer-moves-${c.id}`,
              config: movesGridConfig(c),
            }),
          ]}
        />
      }
      actions={[
        <Button type="submit" label={t(c, 'modal.saveProducts')} variant="primary" disabled={c.busy} />,
      ]}
    />
  )
}
