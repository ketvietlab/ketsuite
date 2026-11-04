// Catalogue and KetAtlas data for KetGrid: order lines to edit, and a long read-only stock list
// that shows drawing only the rows in view. Domain words here are sample data, not a contract.

import type { KetGridIslandConfig } from './index.tsx'
import type { KetGridRow } from './columns.ts'

const products = [
  { value: 'tea-oolong', label: 'Oolong tea 500 g', description: 'TEA-500 · in stock 140' },
  { value: 'tea-green', label: 'Green tea 250 g', description: 'TEA-250 · in stock 62' },
  { value: 'cup-glass', label: 'Glass cup 300 ml', description: 'CUP-300 · in stock 410' },
  { value: 'pot-clay', label: 'Clay teapot', description: 'POT-001 · in stock 9' },
  { value: 'gift-box', label: 'Gift box, large', description: 'BOX-L · in stock 75' },
  { value: 'tray-bamboo', label: 'Bamboo tray', description: 'TRY-02 · in stock 31' },
]

const units = [
  { value: 'unit', label: 'Unit' },
  { value: 'box', label: 'Box' },
  { value: 'kg', label: 'kg' },
]

export const ketGridDemoConfig: KetGridIslandConfig = {
  label: 'Order lines',
  tiers: { key: 'product', by: 'quantity', stepsField: 'priceSteps', lockedBy: 'settled' },
  locale: 'en-US',
  currency: 'USD',
  idField: 'id',
  name: 'lines',
  draftFlags: ['automatic'],
  newRows: [
    {
      label: 'Add line',
      row: {
        kind: 'line',
        product: null,
        description: '',
        quantity: 1,
        unit: 'unit',
        price: null,
        automatic: true,
        discount: 0,
      },
    },
    { label: 'Add section', row: { kind: 'section', description: '', optional: true } },
    { label: 'Add note', row: { kind: 'note', description: '' } },
  ],
  removable: true,
  reorderable: true,
  kindField: 'kind',
  fullWidthKey: 'description',
  // An optional section reads "Teaware · Optional".
  fullWidthTag: { field: 'optional', label: 'Optional' },
  lockedField: 'locked',
  visibleRows: 8,
  columns: [
    {
      key: 'product',
      label: 'Product',
      type: 'combobox',
      editable: true,
      required: true,
      options: products,
      writeSets: { automatic: true },
      placeholder: 'Choose a product',
      width: 200,
    },
    { key: 'description', label: 'Description', editable: true, grow: 1, width: 200 },
    { key: 'quantity', label: 'Quantity', type: 'number', editable: true, required: true, min: 0, width: 96 },
    {
      key: 'unit',
      writeSets: { automatic: true },
      label: 'Unit',
      type: 'select',
      editable: true,
      options: units,
      width: 88,
    },
    {
      key: 'price',
      writeSets: { automatic: false },
      label: 'Unit price',
      type: 'money',
      editable: true,
      required: true,
      min: 0,
      width: 112,
    },
    { key: 'discount', label: 'Disc. %', type: 'percent', editable: true, min: 0, max: 100, width: 88 },
    { key: 'taxed', label: 'Taxed', type: 'checkbox', editable: true, width: 72 },
    { key: 'delivery', label: 'Delivery', type: 'date', editable: true, width: 136 },
    // A margin typed works out the unit price that earns it, from each row's cost.
    {
      key: 'margin',
      label: 'Margin',
      type: 'money',
      editable: true,
      compute: {
        multiply: ['quantity', 'price'],
        percentOff: 'discount',
        less: ['quantity', 'cost'],
        solve: { field: 'price', digits: 2 },
      },
      width: 112,
    },
    {
      key: 'margin',
      writeSets: { automatic: false },
      label: 'Margin',
      type: 'money',
      editable: true,
      width: 112,
      compute: {
        multiply: ['quantity', 'price'],
        percentOff: 'discount',
        less: ['quantity', 'cost'],
        solve: { field: 'price', digits: 2 },
      },
    },
    {
      key: 'subtotal',
      label: 'Subtotal',
      type: 'money',
      compute: { multiply: ['quantity', 'price'], percentOff: 'discount' },
      footer: 'sum',
      pinned: 'end',
      width: 120,
    },
  ],
  rows: [
    { id: 's1', kind: 'section', description: 'Tea' },
    {
      id: 'l1',
      kind: 'line',
      product: 'tea-oolong',
      description: 'Oolong tea 500 g',
      quantity: 12,
      unit: 'box',
      price: 18.5,
      cost: 11,
      discount: 0,
      taxed: true,
      delivery: '2026-10-21',
    },
    {
      id: 'l2',
      kind: 'line',
      product: 'tea-green',
      description: 'Green tea 250 g, delivered',
      quantity: 6,
      unit: 'box',
      price: 9.9,
      cost: 6.2,
      discount: 5,
      taxed: true,
      delivery: '2026-10-14',
      locked: true,
    },
    { id: 'n1', kind: 'note', description: 'Wrap each box separately; the customer collects at the shop.' },
    { id: 's2', kind: 'section', description: 'Teaware', optional: true },
    {
      id: 'l3',
      kind: 'line',
      product: 'pot-clay',
      description: 'Clay teapot',
      quantity: 2,
      unit: 'unit',
      price: 64,
      cost: 38,
      discount: 10,
      taxed: true,
      delivery: '2026-10-24',
    },
    {
      id: 'l4',
      priceSteps: [
        { from: 0, row: { price: 3.25, discount: 0 } },
        { from: 48, row: { price: 3, discount: 5 } },
      ],
      kind: 'line',
      product: 'cup-glass',
      description: 'Glass cup 300 ml',
      quantity: 24,
      unit: 'unit',
      price: 3.25,
      cost: 1.4,
      discount: 0,
      taxed: false,
      delivery: '2026-10-24',
    },
  ],
}

const warehouses = ['Hanoi', 'Da Nang', 'Ho Chi Minh City']
const stockRows: KetGridRow[] = Array.from({ length: 500 }, (_, index) => {
  const number = index + 1
  return {
    id: `sku-${number}`,
    sku: `SKU-${String(number).padStart(4, '0')}`,
    name: `${['Oolong tea', 'Green tea', 'Glass cup', 'Clay teapot', 'Gift box'][index % 5]} #${number}`,
    warehouse: warehouses[index % 3],
    onHand: (number * 37) % 500,
    reserved: (number * 11) % 60,
    value: Math.round(((number * 37) % 500) * (3 + (index % 7)) * 100) / 100,
  }
})

export const ketGridStockDemoConfig: KetGridIslandConfig = {
  label: 'Stock on hand',
  locale: 'en-US',
  currency: 'USD',
  readOnly: true,
  density: 'compact',
  visibleRows: 10,
  columns: [
    { key: 'sku', label: 'SKU', pinned: 'start', width: 112, sortable: true },
    { key: 'name', label: 'Product', grow: 1, width: 200, sortable: true },
    { key: 'warehouse', label: 'Warehouse', width: 160, sortable: true },
    { key: 'onHand', label: 'On hand', type: 'number', width: 104, sortable: true, footer: 'sum' },
    { key: 'reserved', label: 'Reserved', type: 'number', width: 104, sortable: true, footer: 'sum' },
    { key: 'value', label: 'Value', type: 'money', width: 128, sortable: true, footer: 'sum' },
  ],
  rows: stockRows,
}
