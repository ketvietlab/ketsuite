import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowDateField } from '../src/workspace.mjs'
test('compact due dates keep year in accessible name, DS calendar and civil-date bounds', () => {
  const out = renderToStaticString(
    FlowDateField({
      id: 'due',
      label: 'Hạn KV-142',
      value: '2026-10-02',
      min: '2026-09-18',
      onChange: () => {},
    }),
  )
  assert.match(out, /aria-label="Hạn KV-142: 02\/10\/2026"/)
  assert.match(out, />02\/10</)
  assert.match(out, /type="date"/)
  assert.match(out, /data-ui="date-picker"/)
  assert.match(out, /name="kv-date-open"/)
  assert.match(out, /min="2026-09-18"/)
  assert.match(out, /Bỏ hạn/)
  assert.match(out, /popover="auto" role="dialog"/)
})
test('unset and readonly dates retain an accessible placeholder and block edits', () => {
  const out = renderToStaticString(
    FlowDateField({ id: 'empty', label: 'Hạn', value: '', disabled: true, onChange: () => {} }),
  )
  assert.match(out, /Hạn: Chưa đặt/)
  assert.match(out, /Đặt hạn/)
  assert.equal((out.match(/disabled="true"/g) ?? []).length, 4)
})
test('overdue dates retain only the date visually and expose urgency to assistive technology', () => {
  const out = renderToStaticString(
    FlowDateField({ id: 'late', label: 'Due', value: '2026-09-19', overdue: true, onChange: () => {} }),
  )
  assert.match(out, /data-overdue="true"/)
  assert.match(out, /<span>19\/09<\/span>/)
  assert.match(out, /aria-label="Due: 19\/09\/2026 · /)
  assert.doesNotMatch(out, /data-flow="tag"/)
})
test('a consumer-owned menu builds the date input only while open', () => {
  const field = (open) =>
    renderToStaticString(
      FlowDateField({
        id: 'row-due',
        label: 'Hạn KV-142',
        value: '2026-10-02',
        menu: { open, onToggle: () => {} },
        onChange: () => {},
      }),
    )
  const closed = field(false),
    open = field(true)
  assert.doesNotMatch(closed, /type="date"|Bỏ hạn/)
  assert.match(closed, /aria-label="Hạn KV-142: 02\/10\/2026"/)
  assert.match(closed, /id="row-due-menu" data-flow="date-menu" popover="auto"/)
  assert.match(open, /type="date"/)
  assert.match(open, /Bỏ hạn/)
})
