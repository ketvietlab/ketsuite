import type { Translator } from '@ketvietlab/ketjs'
import { selectionLabel as resolveSelection } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'

const generatedNames: Record<string, string> = {
  stock: 'Stock',
  input: 'Input',
  quality: 'Quality',
  output: 'Output',
  pick: 'Pick',
  pack: 'Pack',
  supplier: 'Supplier',
  customer: 'Customer',
  scrap: 'Scrap',
  adjustment: 'Inventory adjustment',
}

/** Records the warehouse generated keep their English seed names; a reader sees them in their own language. */
export const localizeGeneratedRecords = (_: Translator, rows: AnyRow[], group: 'location' | 'pickingType') =>
  rows.map((row) => {
    if (group === 'pickingType') {
      const suffix = String(row.id).split(':').at(-1) ?? ''
      const defaults: Record<string, string> = {
        incoming: 'Receipts',
        outgoing: 'Delivery Orders',
        internal: 'Internal Transfers',
        quality: 'Quality Control',
        store: 'Store',
        pick: 'Pick',
        pack: 'Pack',
        adjustment: 'Inventory Adjustments',
        scrap: 'Scrap',
        count: 'Physical count',
      }
      return defaults[suffix] === row.name
        ? { ...row, name: resolveSelection(_, 'stock_backend', 'record.pickingType', suffix) }
        : row
    }
    const suffix = String(row.id).split(':').at(-1) ?? ''
    return generatedNames[suffix] === row.name
      ? { ...row, name: resolveSelection(_, 'stock_backend', 'record.location', suffix) }
      : row
  })
