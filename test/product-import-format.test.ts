import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseProductImport,
  ProductImportRefused,
  importMoney,
  importAttributeValues,
  exportProductImportCsv,
} from '../packages/ketsuite/src/modules/product/import-format.ts'
const rejects = (data: string, code: string) =>
  assert.throws(
    () => parseProductImport(data),
    (error: unknown) =>
      error instanceof ProductImportRefused && error.issues.some((issue) => issue.code.endsWith('.' + code)),
  )
test('P53 aliases, unknown columns and quoted multiline cells preserve one variant per row', () => {
  const rows = parseProductImport(
    '\uFEFFGia ban\tTen san pham\tMa san pham\tunknown\tGia tri thuoc tinh\r\n159.000\t"A\n""B"""\tabc\tx\tMàu: Đỏ; Cỡ: S\r\n\t\tABC\t\tMàu: Xanh; Cỡ: M',
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.cells.name, 'A\n"B"')
  assert.equal(rows[0]!.cells.templateCode, 'abc')
  assert.equal(rows[1]!.cells.templateCode, 'ABC')
  assert.equal(rows[0]!.cells.listPrice, '159.000')
  assert.deepEqual(importAttributeValues(rows[0]!.cells.values!, 2), [
    { attribute: 'Màu', value: 'Đỏ' },
    { attribute: 'Cỡ', value: 'S' },
  ])
})
test('P53 rejects duplicate aliases, missing code, malformed quotes and ragged data with row/column issues', () => {
  rejects('Product code,Ma san pham\na,b', 'duplicateColumn')
  rejects('Name\nA', 'requiredColumn')
  rejects('Product code,Name\n,A', 'required')
  rejects('Product code,Name\na,"unfinished', 'quotes')
  rejects('Product code,Name\na,"closed"bad', 'quotes')
  rejects('Product code,Name\na,b,c', 'columns')
  assert.throws(
    () => parseProductImport('Product code,Name\na,A\n,B'),
    (error: unknown) =>
      error instanceof ProductImportRefused &&
      error.issues[0]?.row === 3 &&
      error.issues[0]?.column === 'templateCode',
  )
})
test('P53 caps nonblank records and UTF-8 bytes while accepting both exact boundaries', () => {
  assert.equal(
    parseProductImport('Product code\n' + Array.from({ length: 500 }, (_, i) => 'P' + i).join('\n')).length,
    500,
  )
  rejects('Product code\n' + Array.from({ length: 501 }, (_, i) => 'P' + i).join('\n'), 'rows')
  const header = 'Product code,Unknown\nA,'
  assert.equal(parseProductImport(header + 'x'.repeat(262144 - Buffer.byteLength(header))).length, 1)
  rejects(header + 'đ'.repeat(262144 / 2), 'bytes')
})
test('P53 interprets thousands and exact decimal money without floating-point rounding', () => {
  for (const value of ['159.000', '159,000', '159000', '0159000'])
    assert.equal(importMoney(value, 2, 'cost'), '159000')
  assert.equal(importMoney('9,007,199,254,740,993.25', 2, 'cost'), '9007199254740993.25')
  assert.equal(importMoney('1.234,50', 2, 'cost'), '1234.5')
  for (const value of ['-1', '1e6', 'Infinity', '=1+1', '1,2,3'])
    assert.throws(() => importMoney(value, 2, 'cost'), ProductImportRefused)
})
test('P54 CSV formula guards round-trip apostrophes, quotes, tabs, commas and Unicode exactly', () => {
  const names = ['=1+1', ' +SUM(A1)', "'=literal", "'ordinary", 'A,"B"\nC', 'Đỏ\tXanh']
  const csv = exportProductImportCsv([
    ['Product code', 'Product name'],
    ...names.map((name, i) => ['P' + i, name]),
  ])
  assert.match(csv, /'\+SUM|[' ]\+SUM/)
  assert.deepEqual(
    parseProductImport(csv).map((row) => row.cells.name),
    names,
  )
})
