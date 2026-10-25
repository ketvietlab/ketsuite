import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvCells, decodeExchange, encodeExchange, exchangeBatch } from '../client/exchange-contract.mjs'

test('task exchange round trips formulas, quotes, Unicode, newlines and structured values', () => {
  const rows = [
    {
      sourceId: 'one',
      title: '=HYPERLINK("https://example.test")',
      description: 'Dòng 1, "quoted"\r\nDòng 2',
      points: 0,
      tagIds: ['tag-1'],
      fieldValues: { text: '@data', n: 42 },
      checklist: [{ id: 'c', text: 'Check', checked: false }],
    },
    {
      sourceId: 'two',
      title: "'=literal",
      description: "' leading apostrophe",
      priority: 'normal',
      expectedVersion: 3,
    },
    { sourceId: 'three', title: ' +1', description: '\t=SUM(A1:A2)' },
    {
      sourceId: 'four',
      title: 'Empty and null',
      description: '',
      dueDate: null,
      startDate: null,
      typeId: null,
      fieldValues: {},
      tagIds: [],
    },
  ]
  for (const format of ['csv', 'json'])
    assert.deepEqual(decodeExchange(encodeExchange(rows, format), format), rows)
  const cells = csvCells(encodeExchange(rows, 'csv'))
  assert.equal(
    cells[1][cells[0].indexOf('title')].startsWith("'="),
    true,
    'CSV title cells cannot execute spreadsheet formulas',
  )
})
test('task exchange refuses malformed quotes, unknown columns, schema and duplicate sources', () => {
  for (const csv of [
    'schema,version,sourceId,title\nflow.task-exchange,1,a,"unclosed',
    'schema,version,sourceId,title\nflow.task-exchange,1,a,"ok"tail',
    'schema,version,sourceId,foreign\nflow.task-exchange,1,a,no',
  ])
    assert.throws(() => decodeExchange(csv, 'csv'))
  assert.throws(() => decodeExchange(JSON.stringify({ schema: 'flow.task-exchange', version: 2, rows: [] })))
  assert.throws(() =>
    decodeExchange(
      encodeExchange([
        { sourceId: 'same', title: 'A' },
        { sourceId: 'same', title: 'B' },
      ]),
    ),
  )
})

test('exchange batches respect UTF-8 bytes and permit complete traversal without missing rows', () => {
  const rows = Array.from({ length: 105 }, (_, i) => ({
    sourceId: String(i),
    title: 'Record ' + i,
    description: 'ế'.repeat(10000),
  }))
  const copied = []
  let offset = 0
  while (offset < rows.length) {
    const batch = exchangeBatch(rows, offset, 70000)
    assert.equal(batch.length <= 2, true)
    copied.push(...batch)
    offset += batch.length
  }
  assert.deepEqual(copied, rows)
  assert.throws(() =>
    exchangeBatch([{ sourceId: 'big', title: 'Too large', description: 'a'.repeat(1000000) }], 0),
  )
})

test('exchange refuses oversized mapping arrays before rendering file controls', () => {
  assert.throws(() =>
    decodeExchange(
      encodeExchange([{ sourceId: 'many-tags', title: 'Large', tagIds: Array(10000).fill('tag') }]),
    ),
  )
  assert.throws(() =>
    decodeExchange(encodeExchange([{ sourceId: 'bad-fields', fieldValues: 'not an object' }])),
  )
  assert.throws(() => decodeExchange(encodeExchange([{ sourceId: '  ', title: 'Blank identity' }])))
})
