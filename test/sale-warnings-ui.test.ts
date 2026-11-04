import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saleWarningSelection } from '../packages/ketsuite/src/modules/sale_backend/record/warning-selection.ts'
test('D32 preview follows unsaved product selection, deletion and ordering without accepting warning text', () => {
  const record = {
    partnerId: 'saved',
    lines: [
      { id: 'one', productId: 'old' },
      { id: 'two', productId: 'removed' },
      { id: 'gift', productId: 'gift', lineKind: 'reward' },
    ],
  }
  const changes = {
    updated: [{ id: 'one', values: { productId: 'new', warning: 'forged' } }],
    added: [
      { id: 'new-row', values: { productId: 'added' } },
      { id: 'section', values: { productId: 'ignored', displayType: 'section' } },
    ],
    removed: ['two'],
    order: ['new-row', 'one', 'gift', 'section'],
  }
  assert.deepEqual(
    saleWarningSelection(
      record,
      (key, fallback) => ({ partnerId: 'selected', lines: JSON.stringify(changes) })[key] ?? fallback,
    ),
    { partnerId: 'selected', productIds: ['added', 'new', 'gift'] },
  )
  assert.deepEqual(
    saleWarningSelection(record, (key, fallback) => (key === 'lines' ? '{broken' : fallback)),
    { partnerId: 'saved', productIds: ['old', 'removed', 'gift'] },
  )
})
