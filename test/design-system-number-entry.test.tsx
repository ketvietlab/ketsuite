import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  formatLocaleNumber,
  MoneyField,
  NumberField,
  numberControlValue,
  parseLocaleNumber,
} from '@ketvietlab/design-system'
import {
  attachNumberEntry,
  normalizeNumberEntries,
} from '../packages/design-system/src/runtime/number-entry.js'

// A Vietnamese reader writes 28 600 as "28.600" and 28,6 as "28,6"; an English reader the other way
// round. The field must read what each meant, and the server must receive one plain decimal.

test('localized numbers read the way each language writes them', () => {
  const cases: [string, string, string | null][] = [
    ['28.600', 'vi', '28600'],
    ['28.000', 'vi', '28000'],
    ['1.800.000', 'vi', '1800000'],
    ['1.234.567,89', 'vi', '1234567.89'],
    ['28,6', 'vi', '28.6'],
    [',5', 'vi', '0.5'],
    ['-50.000', 'vi', '-50000'],
    ['−50.000', 'vi', '-50000'],
    ['+7', 'vi', '7'],
    [' 1 800 000 ', 'vi', '1800000'],
    ['1 800 000', 'vi', '1800000'],
    ['007', 'vi', '7'],
    ['-0', 'vi', '0'],
    // The other habit's decimal point is read as one where it cannot be grouping.
    ['12.5', 'vi', '12.5'],
    ['1.5000', 'vi', '1.5000'],
    ['', 'vi', ''],
    ['   ', 'vi', ''],
    // Not numbers in Vietnamese: grouping that is not in threes, two decimal marks, letters.
    ['1.23.456', 'vi', null],
    ['1,2,3', 'vi', null],
    ['1,234.5', 'vi', null],
    ['12a', 'vi', null],
    ['-', 'vi', null],
    ['1.000.00', 'vi', null],
    ['28,600', 'en', '28600'],
    ['1,234.5', 'en', '1234.5'],
    ['28.6', 'en', '28.6'],
    ['12,5', 'en', '12.5'],
    ['1.234,5', 'en', null],
  ]
  for (const [text, locale, expected] of cases)
    assert.equal(parseLocaleNumber(text, locale), expected, `${locale} ${JSON.stringify(text)}`)
})

test('plain decimals are written for the reader, and anything else is shown as typed', () => {
  const cases: [string | number | null, string, string][] = [
    ['1800000', 'vi', '1.800.000'],
    ['1234567.89', 'vi', '1.234.567,89'],
    ['-50000', 'vi', '-50.000'],
    ['999', 'vi', '999'],
    ['0.5', 'vi', '0,5'],
    [2700000, 'vi', '2.700.000'],
    ['1800000', 'en', '1,800,000'],
    ['1234.5', 'en', '1,234.5'],
    ['', 'vi', ''],
    [null, 'vi', ''],
    ['28,5', 'vi', '28,5'],
    ['abc', 'vi', 'abc'],
  ]
  for (const [value, locale, expected] of cases)
    assert.equal(formatLocaleNumber(value, locale), expected, `${locale} ${JSON.stringify(value)}`)
  // What is shown reads back as what was given.
  for (const value of ['0', '7', '1800000', '-50000', '1234567.89', '0.05'])
    for (const locale of ['vi', 'en'])
      assert.equal(parseLocaleNumber(formatLocaleNumber(value, locale), locale), value, `${locale} ${value}`)
})

const control = (value: string, locale: string | null, name = 'amount', defaultValue = value) => ({
  name,
  value,
  defaultValue,
  disabled: false,
  readOnly: false,
  getAttribute: (key: string) => (key === 'data-number-locale' ? locale : null),
  matches: (selector: string) => selector === 'input[data-number-locale]' && locale !== null,
})

test('a localized control is read as its plain decimal; other controls and typos as typed', () => {
  assert.equal(numberControlValue(control('1.800.000', 'vi')), '1800000')
  assert.equal(numberControlValue(control('1.800.000', 'vi'), '2.700.000'), '2700000')
  assert.equal(numberControlValue(control('1.800.000', null)), '1.800.000')
  assert.equal(numberControlValue(control('28,5,1', 'vi')), '28,5,1')
})

test('the form data carries plain decimals, and leaves a name others also submit alone', () => {
  const data = new FormData()
  data.append('amount', '28.600')
  data.append('label', 'Taxi 1.000')
  data.append('price', '1.234,5')
  data.append('price', '2.000')
  data.append('shared', '1.000')
  data.append('shared', 'x')
  normalizeNumberEntries(
    [
      control('28.600', 'vi', 'amount'),
      control('1.234,5', 'vi', 'price'),
      control('2.000', 'vi', 'price'),
      control('1.000', 'vi', 'shared'),
    ],
    data,
  )
  assert.deepEqual(data.getAll('amount'), ['28600'])
  assert.deepEqual(data.getAll('price'), ['1234.5', '2000'])
  assert.deepEqual(data.getAll('label'), ['Taxi 1.000'], 'text fields keep their dots')
  assert.deepEqual(data.getAll('shared'), ['1.000', 'x'], 'a name with another source is not guessed at')
})

test('the runtime regroups on leaving a field and rewrites the submitted data, once per document', () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const doc = {
    addEventListener: (type: string, listener: (event: unknown) => void, capture: boolean) => {
      assert.equal(capture, true, 'it sees the event before the form and its islands do')
      listeners.set(type, listener)
    },
    removeEventListener: (type: string) => listeners.delete(type),
  }
  const cleanup = attachNumberEntry(doc as unknown as Document)
  assert.equal(typeof attachNumberEntry(doc as unknown as Document), 'function')
  assert.deepEqual([...listeners.keys()].sort(), ['focusout', 'formdata'])
  const typed = control('28600', 'vi')
  listeners.get('focusout')!({ target: typed })
  assert.equal(typed.value, '28.600')
  const typo = control('28,6,0', 'vi')
  listeners.get('focusout')!({ target: typo })
  assert.equal(typo.value, '28,6,0', 'a typo stays for the reader to correct')
  const locked = { ...control('28600', 'vi'), readOnly: true }
  listeners.get('focusout')!({ target: locked })
  assert.equal(locked.value, '28600', 'a read-only value is not rewritten')
  const plain = control('28600', null)
  listeners.get('focusout')!({ target: plain })
  assert.equal(plain.value, '28600')
  const formData = new FormData()
  formData.append('amount', '28.000')
  formData.append('note', '1.000')
  const disabled = { ...control('5.000', 'vi', 'off'), disabled: true }
  listeners.get('formdata')!({
    target: { elements: [control('28.000', 'vi'), control('1.000', null, 'note'), disabled] },
    formData,
  })
  assert.deepEqual(formData.getAll('amount'), ['28000'])
  assert.deepEqual(formData.getAll('note'), ['1.000'])
  cleanup()
  assert.equal(listeners.size, 0)
})

test('NumberField and MoneyField with a locale are text inputs showing the reader their own marks', () => {
  const money = renderToString(
    <MoneyField
      id="amount"
      name="amount"
      label="Số tiền"
      value="1800000"
      currency="VND"
      precision={0}
      locale="vi"
    />,
  )
  assert.match(money, /<input[^>]*type="text"/u)
  assert.match(money, /inputmode="decimal"/u)
  assert.match(money, /data-number-locale="vi"/u)
  assert.match(money, /value="1\.800\.000"/u)
  assert.doesNotMatch(money, /step=/u, 'a text input has no step to validate against')
  assert.match(money, /VND/u, 'the currency still reads beside the amount')
  const quantity = renderToString(
    <NumberField id="qty" name="qty" label="Số lượng" value="2.5" locale="vi" />,
  )
  assert.match(quantity, /value="2,5"/u)
  assert.match(quantity, /data-number-locale="vi"/u)
  const english = renderToString(<MoneyField id="usd" name="usd" label="Amount" value="1234.5" locale="en" />)
  assert.match(english, /value="1,234\.5"/u)
  // Without a locale nothing changes: the native number input, as before.
  const native = renderToString(
    <MoneyField id="raw" name="raw" label="Amount" value="2700000" precision={0} />,
  )
  assert.match(native, /type="number"/u)
  assert.match(native, /value="2700000"/u)
  assert.match(native, /step="1"/u)
  assert.doesNotMatch(native, /data-number-locale/u)
  const locked = renderToString(
    <MoneyField id="locked" name="locked" label="Đã thu" value="2700000" readOnly locale="vi" />,
  )
  assert.match(locked, /value="2\.700\.000"/u, 'a locked amount reads grouped too')
})

test('the shared runtime attaches number entry and removes it with everything else', () => {
  const runtime = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
  assert.match(runtime, /import \{ attachNumberEntry \} from '\.\/number-entry\.js'/u)
  assert.match(runtime, /const cleanupNumberEntry = attachNumberEntry\(document\)/u)
  assert.match(runtime, /cleanupApplyOnInput\(\)\n\s*cleanupNumberEntry\(\)/u)
})
