import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import {
  defaultImportRules,
  exportImportCsv,
  guessImportMapping,
  IMPORT_LIMITS,
  importNameKey,
  mapImportRow,
  parseDelimited,
  parseImportFile,
} from '../packages/ketsuite/src/modules/crm/import-format.ts'

const input = (content: string, filename = 'contacts.csv') => ({
  filename,
  content: Buffer.from(content).toString('base64'),
})
export function xlsxFixture(
  sheetXml = '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Phone</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Mai</t></is></c><c r="B2" t="inlineStr"><is><t>0901234567</t></is></c></row>',
  streaming = false,
  parts: Record<string, string> = {},
) {
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`,
    ...parts,
  }
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const [name, xml] of Object.entries(files)) {
    const data = Buffer.from(xml),
      zipped = deflateRawSync(data),
      filename = Buffer.from(name),
      head = Buffer.alloc(30),
      entry = Buffer.alloc(46)
    head.writeUInt32LE(0x04034b50)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(8, 8)
    head.writeUInt32LE(crc32(data), 14)
    head.writeUInt32LE(zipped.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(filename.length, 26)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc32(data), 16)
    entry.writeUInt32LE(zipped.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(filename.length, 28)
    entry.writeUInt32LE(offset, 42)
    const descriptor = Buffer.alloc(streaming ? 16 : 0)
    if (streaming) {
      head.writeUInt16LE(8, 6)
      head.writeUInt32LE(0, 14)
      head.writeUInt32LE(0, 18)
      head.writeUInt32LE(0, 22)
      entry.writeUInt16LE(8, 8)
      descriptor.writeUInt32LE(0x08074b50)
      descriptor.writeUInt32LE(crc32(data), 4)
      descriptor.writeUInt32LE(zipped.length, 8)
      descriptor.writeUInt32LE(data.length, 12)
    }
    local.push(head, filename, zipped, descriptor)
    central.push(entry, filename)
    offset += head.length + filename.length + zipped.length + descriptor.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

test('CRM import reads quoted CSV, TSV, BOM and UTF-16 without losing phone zeros', async () => {
  const csv = await parseImportFile(
    input('\uFEFFHọ tên,Điện thoại,Ghi chú\r\n"Nguyễn, Mai",0901234567,"Dòng 1\nDòng ""hai"""\r\n'),
  )
  assert.deepEqual(csv.mapping, ['name', 'phone', 'description'])
  assert.deepEqual(csv.rows, [['Nguyễn, Mai', '0901234567', 'Dòng 1\nDòng "hai"']])
  const tsv = await parseImportFile(input('Name\tPhone\nMai\t0901234567', 'sheet.tsv'))
  assert.equal(tsv.rows[0][1], '0901234567')
  const utf16 = await parseImportFile({
    filename: 'contacts.csv',
    content: Buffer.from('\uFEFFName;Phone\nMai;0901234567', 'utf16le').toString('base64'),
  })
  assert.equal(utf16.encoding, 'UTF-16LE')
  assert.equal(utf16.delimiter, ';')
})
test('CRM import rejects ambiguous quoting, row/column/cell limits, malformed encoding and unsupported formats', async () => {
  assert.throws(() => parseDelimited('name,phone\n"Mai"oops,0901234567', ','), /quotes/)
  assert.throws(() => parseDelimited('name,phone\n"Mai,0901234567', ','), /quotes/)
  await assert.rejects(
    parseImportFile(input('Name,Phone\n' + 'Mai,0901234567\n'.repeat(IMPORT_LIMITS.rows + 1))),
    /rows/,
  )
  await assert.rejects(
    parseImportFile(input(Array(65).fill('column').join(',') + '\nMai,0901234567')),
    /columns/,
  )
  await assert.rejects(parseImportFile(input('Name,Phone\n' + 'x'.repeat(8001) + ',0901234567')), /cell/)
  await assert.rejects(
    parseImportFile({ filename: 'x.csv', content: Buffer.from([0xff, 0x00, 0x0a]).toString('base64') }),
    /encoding/,
  )
  await assert.rejects(parseImportFile(input('Name,Phone\nMai,0901234567', 'file.xls')), /format/)
})
test('CRM import reads an actual XLSX and rejects sparse allocation and XML entities', async () => {
  const parsed = await parseImportFile({
    filename: 'contacts.xlsx',
    content: xlsxFixture().toString('base64'),
  })
  assert.deepEqual(
    (
      await parseImportFile({
        filename: 'streamed.xlsx',
        content: xlsxFixture(undefined, true).toString('base64'),
      })
    ).rows,
    parsed.rows,
  )
  await assert.rejects(
    parseImportFile({
      filename: 'sparse.xlsx',
      content: xlsxFixture("<row r='999999'><c r='A999999'><v>1</v></c></row>").toString('base64'),
    }),
    /rows/,
  )
  assert.deepEqual(parsed.sheets, ['Contacts'])
  assert.deepEqual(parsed.rows, [['Mai', '0901234567']])
  await assert.rejects(
    parseImportFile({
      filename: 'x.xlsx',
      content: xlsxFixture('<row r="1048576"><c r="A1048576"><v>1</v></c></row>').toString('base64'),
    }),
    /rows/,
  )
  await assert.rejects(
    parseImportFile({ filename: 'x.xlsx', content: xlsxFixture('<!ENTITY x "bad">').toString('base64') }),
    /workbook/,
  )
  await assert.rejects(
    parseImportFile({ filename: 'x.xlsx', content: xlsxFixture().toString('base64'), sheet: 'missing' }),
    /sheet/,
  )
})
const sheetPart = (rows: string) =>
  `<x:worksheet xmlns:x="urn:x"><x:sheetData>${rows}</x:sheetData></x:worksheet>`
test('CRM import reads XLSX cells as the spreadsheet shows them, without a third-party reader', async () => {
  const content = xlsxFixture(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Mới</t></is></c><c r="D1" t="s"><v>2</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>46309</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" s="2"><v>901234567</v></c></row>' +
      '<row><c s="3"><v>46309.5</v></c><c t="inlineStr"><is><t xml:space="preserve"> A &amp; B &#x1F600;</t></is></c><c/></row><row r="9"><c r="F9"/></row>',
    false,
    {
      'xl/sharedStrings.xml':
        '<sst><si><t>Họ tên</t></si><si><r><t>Ngày</t></r><r><t xml:space="preserve"> đăng ký</t></r><rPh sb="0" eb="1"><t>X</t></rPh></si><si><t>Điện thoại</t></si><si><t>Nguyễn Mai</t></si></sst>',
      'xl/styles.xml':
        '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellStyleXfs><xf numFmtId="14"/><xf numFmtId="14"/></cellStyleXfs><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="1"/><xf numFmtId="22"/></cellXfs></styleSheet>',
    },
  )
  const parsed = await parseImportFile({ filename: 'contacts.xlsx', content: content.toString('base64') })
  assert.deepEqual(parsed.headers, ['Họ tên', 'Ngày đăng ký', 'Mới', 'Điện thoại'])
  // A missing row is an empty row; trailing empty rows and columns are not part of the sheet.
  assert.deepEqual(parsed.rows, [
    ['', '', '', ''],
    ['Nguyễn Mai', '2026-10-14T00:00:00.000Z', 'true', '901234567'],
    ['2026-10-14T12:00:00.000Z', ' A & B 😀', '', ''],
  ])

  // 1904-based workbooks count days from a later epoch; the chosen sheet is read, never the first by accident.
  const second = xlsxFixture(undefined, false, {
    'xl/workbook.xml':
      '<workbook xmlns:r="urn:r"><workbookPr date1904="1"/><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/><sheet name="Khách &amp; mới" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet2.xml': sheetPart(
      '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Ngày</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" s="1"><x:v>44847</x:v></x:c></x:row>',
    ),
    'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  })
  const chosen = await parseImportFile({
    filename: 'x.xlsx',
    content: second.toString('base64'),
    sheet: 'Khách & mới',
  })
  assert.deepEqual(chosen.sheets, ['Contacts', 'Khách & mới'])
  assert.deepEqual(chosen.rows, [['2026-10-14T00:00:00.000Z']])
  assert.deepEqual((await parseImportFile({ filename: 'x.xlsx', content: second.toString('base64') })).rows, [
    ['Mai', '0901234567'],
  ])

  for (const [sheet, error] of [
    ['<row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA[x]]></t></is></c></row>', /workbook/],
    ['<row r="1"><c r="A1" t="s"><v>7</v></c></row>', /workbook/],
    ['<row r="1"><c r="BM1"><v>1</v></c></row>', /columns/],
  ] as const)
    await assert.rejects(
      parseImportFile({ filename: 'x.xlsx', content: xlsxFixture(sheet).toString('base64') }),
      error,
    )
})
test('CRM import scans hostile workbook XML in linear time', async () => {
  const started = performance.now()
  for (const sheet of [
    '<row '.repeat(200_000),
    `<c ${'x'.repeat(1_000_000)}`,
    `<row><c ${'x'.repeat(4000)}/></row>`.repeat(250),
  ])
    await assert.rejects(
      parseImportFile({ filename: 'x.xlsx', content: xlsxFixture(sheet).toString('base64') }),
    )
  assert.ok(performance.now() - started < 5000, 'unterminated tags must not rescan the rest of the part')
})
test('CRM import mapping normalizes contacts and tags while preserving consent absence', () => {
  const rules = defaultImportRules(),
    mapping = guessImportMapping(['full_name', 'phone_number', 'email', 'Quan tâm'])
  const valid = mapImportRow(
    ['Mai', '0901234567', 'MAI@EXAMPLE.TEST', 'Trị mụn; Spa | Khách mới'],
    mapping,
    rules,
  )
  assert.equal(valid.value.phone, '+84901234567')
  assert.equal(valid.value.email, 'mai@example.test')
  assert.equal(valid.value.recordTags.length, 3)
  assert.deepEqual(valid.issues, [])
  assert.equal(importNameKey('  TRI   MỤN  '), importNameKey('Trị mụn'))
  assert.equal('contactConsent' in valid.value, false)
  assert.deepEqual(mapImportRow(['', 'invalid', 'bad-email'], ['name', 'phone', 'email'], rules).issues, [
    'name',
    'phone',
    'email',
  ])
})
test('CRM import error export cannot execute spreadsheet formulas', () => {
  const csv = exportImportCsv([['=HYPERLINK("bad")', '+84901234567', '@SUM(1)', 'ordinary']])
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"\'+84901234567"'))
  assert.ok(csv.includes('"\'@SUM(1)"'))
})
