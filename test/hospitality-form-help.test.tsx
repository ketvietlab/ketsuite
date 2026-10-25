import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  HospitalityGuestForm,
  RoomTypeFormSections,
} from '../packages/ketsuite/src/modules/hospitality_core/records/form-sections.tsx'
import { catalogueRecords } from '../packages/ketsuite/src/modules/hospitality_core/records/config.ts'
import {
  hospitalityHelpSource,
  hospitalityScreenHelp,
} from '../packages/ketsuite/src/modules/hospitality_core/screens/screen-help.tsx'

test('Hospitality grouped forms keep one submit owner, complete field names and refused raw values', () => {
  const t = (key: string) => (key.endsWith('.guest') ? 'Adult {number}' : key)
  const html = renderToString(
    <HospitalityGuestForm
      kind="arrival"
      id="arrival-form"
      command="checkIn"
      t={t}
      fields={[
        { name: 'keys', id: 'keys', label: 'Keys', value: '2', type: 'number' },
        { name: 'guest-0-fullName', id: 'guest-0-name', label: 'First name', value: 'Original guest' },
        {
          name: 'guest-1-fullName',
          id: 'guest-1-name',
          label: 'Second name',
          value: '  Unsaved <name>  ',
          error: 'Correct the name',
        },
        {
          name: 'guest-1-number',
          id: 'guest-1-document',
          label: 'Document',
          value: 'not-a-number',
          disabled: true,
        },
      ]}
    />,
  )
  assert.equal((html.match(/<form\b/gu) ?? []).length, 1)
  assert.match(html, /name="__command" value="checkIn"/u)
  for (const name of ['keys', 'guest-0-fullName', 'guest-1-fullName', 'guest-1-number'])
    assert.equal((html.match(new RegExp(`name="${name}"`, 'gu')) ?? []).length, 1)
  assert.match(html, /Adult 1/u)
  assert.match(html, /Adult 2/u)
  assert.match(html, /aria-labelledby="arrival-form-guest-1-title"/u)
  assert.match(html, /value=" {2}Unsaved &lt;name&gt; {2}"/u)
  assert.match(html, /aria-invalid="true"/u)
  assert.match(html, /Correct the name/u)
  assert.match(html, /id="guest-1-document"[^>]*disabled/u)
  const added = renderToString(
    <HospitalityGuestForm
      kind="arrival"
      t={t}
      guestOffset={2}
      fields={[{ id: 'added-name', name: 'guest-0-fullName', label: 'Name' }]}
    />,
  )
  assert.match(added, /Adult 3/u)
  const definition = catalogueRecords.find((item) => item.kind === 'roomType')!
  const grouped = renderToString(
    <RoomTypeFormSections
      id="room-type"
      t={t}
      fields={definition.fields.map((field) => ({
        name: field.name,
        id: field.name,
        label: field.label,
        type: 'text',
      }))}
    />,
  )
  for (const field of definition.fields)
    assert.equal((grouped.match(new RegExp(`name="${field.name}"`, 'gu')) ?? []).length, 1, field.name)
  assert.doesNotMatch(grouped, /<form\b/u)
})

test('Hospitality Help chooses the most specific route, localizes decisions and retains safe Mermaid fallback', () => {
  const route = (path: string) => new URL(`https://example.test/admin/hospitality/${path}`)
  assert.equal(hospitalityHelpSource(route('unknown'), 'vi'), null)
  const booking = hospitalityHelpSource(route('reservations/new'), 'en')!
  assert.match(booking, /Choose dates and guests/u)
  assert.doesNotMatch(booking, /Record check-in/u)
  const arrival = hospitalityHelpSource(route('reservations/one'), 'en')!
  assert.match(arrival, /Record check-in/u)
  assert.doesNotMatch(arrival, /Needs action first/u)
  // The book is a list with its own job: finding a booking, not working one.
  const book = hospitalityHelpSource(route('reservations'), 'vi')!
  assert.match(book, /Cần xử lý trước/u)
  assert.match(book, /Thấy đặt phòng<br>cần tìm\?/u)
  assert.doesNotMatch(book, /Ghi nhận nhận phòng/u)
  assert.match(hospitalityHelpSource(route('reservations'), 'en')!, /Guest names match with their accents/u)
  // So are the guests in house: finding a guest, and what the balance column does and does not say.
  const house = hospitalityHelpSource(route('stays'), 'en')!
  assert.match(house, /accents are optional/u)
  assert.match(house, /\*\*Walk-in guest\*\* in the page header/u)
  assert.match(house, /Found the<br>guest\?/u)
  assert.match(house, /\*\*Unknown\*\* means the invoice evidence is missing, not that the folio is paid/u)
  assert.doesNotMatch(house, /Open a stay to review its room/u)
  assert.match(hospitalityHelpSource(route('stays'), 'vi')!, /Phiếu chi phí chung · N phòng/u)
  assert.match(hospitalityHelpSource(route('stays/one'), 'en')!, /Open a stay to review its room/u)
  assert.doesNotMatch(hospitalityHelpSource(route('stays/one'), 'en')!, /accents are optional/u)
  // And the folio register: how it is searched and ordered, and what its money columns do and do not say.
  const register = hospitalityHelpSource(route('folios'), 'en')!
  assert.match(register, /must be typed in full \(for example “302”\)/u)
  assert.match(register, /\*\*Not posted\*\* is a draft invoice/u)
  assert.match(register, /see who still owes on the billing list/u)
  assert.match(register, /Found the<br>folio\?/u)
  assert.doesNotMatch(register, /The guest bill uses the shared record page/u)
  assert.match(hospitalityHelpSource(route('folios'), 'vi')!, /Kết quả chưa đủ/u)
  assert.match(
    hospitalityHelpSource(route('folios/one'), 'en')!,
    /The guest bill uses the shared record page/u,
  )
  assert.doesNotMatch(hospitalityHelpSource(route('folios/one'), 'en')!, /must be typed in full/u)
  // The billing book: its period, owed invoices of any age, overlapping facets, and steps a reader may not take.
  const billing = hospitalityHelpSource(route('billing'), 'en')!
  assert.match(billing, /last 7, 30 or 90 days by the day the folio closed/u)
  assert.match(billing, /whose invoice is \*\*not fully paid\*\* or \*\*not posted\*\* however long ago/u)
  assert.match(billing, /may overlap/u)
  assert.match(billing, /A step you may not take reads \*\*View folio\*\*/u)
  assert.match(billing, /Work left<br>to do\?/u)
  assert.doesNotMatch(billing, /reconciles folios with actual evidence/u)
  assert.match(hospitalityHelpSource(route('billing'), 'vi')!, /Sổ chưa đủ/u)
  assert.doesNotMatch(hospitalityHelpSource(route('billing/rules'), 'en')!, /last 7, 30 or 90 days/u)
  // Billing rules: every charge type is a row, and a rule answers the tax question one way (HOS-DEC-034).
  const rules = hospitalityHelpSource(route('billing/rules'), 'en')!
  assert.match(rules, /Every charge type is a row, including those nobody has set up yet/u)
  assert.match(rules, /the list has no create button/u)
  assert.match(rules, /Is the charge<br>taxed\?/u)
  assert.doesNotMatch(rules, /Values and version valid\?/u)
  assert.match(hospitalityHelpSource(route('billing/rules'), 'vi')!, /Loại phí<br>chịu thuế\?/u)
  // The in-house list sends who still owes to the billing list, not to the folio register.
  assert.match(house, /on the front desk or on the billing list/u)
  const en = hospitalityHelpSource(route('inventory'), 'en')!
  const vi = hospitalityHelpSource(route('inventory'), 'vi')!
  assert.match(en, /Every selected date valid/u)
  assert.match(vi, /Tất cả ngày đều hợp lệ/u)
  assert.match(en, /flowchart TD/u)
  assert.match(en, /:::kv-decision/u)
  assert.doesNotMatch(en, /classDef|%%\{init|themeVariables/u)
  const html = renderToString(hospitalityScreenHelp(route('inventory'), 'Inventory', 'en')!)
  assert.match(html, /data-ui="help-drawer"/u)
  assert.match(html, /Every selected date valid/u)
  assert.match(html, /View source/u)
  assert.match(html, /Workflow and decisions/u)
})
