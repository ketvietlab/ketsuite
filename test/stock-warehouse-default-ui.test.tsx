import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { defaultWarehouseId } from '../packages/ketsuite/src/modules/stock/default-warehouse.ts'

type Row = Record<string, unknown>
const html = (value: unknown) => renderToString(value as TemplateResult).replaceAll('&quot;', '"')
const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}
const record = {
  id: 'wh',
  name: 'Main',
  code: 'WH',
  receptionSteps: 'one_step',
  deliverySteps: 'ship_only',
  userIds: ['lan'],
}
const people = [
  { id: 'lan', name: 'Lan' },
  { id: 'minh', name: 'Minh' },
]
const modal = (save: boolean, drafts: Record<string, string> = {}, refused = true) =>
  ({
    kind: 'stock.warehouse',
    id: 'wh',
    creating: false,
    data: { record, lang: 'vi', draftId: 'draft-id', save, choices: { people } },
    draft: (key: string, fallback: string) => drafts[key] ?? fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: (name: string) => (refused && name === 'userIds' ? 'refused' : undefined),
    t: (key: string) => key,
    busy: false,
  }) as never

test('K15 the warehouse form picks its staff among the company’s people and posts them as a list', () => {
  const warehouse = stockConfigurationDefinition('warehouse')
  const body = html(warehouse.body!(modal(true)))
  // One picker of several people, holding who is assigned, offering the company's people.
  const picker =
    /"name":"userIds"[\s\S]*?"multiple":true[\s\S]*?"values":\["lan"\][\s\S]*?"options":(\[[^\]]*\])/.exec(
      body,
    )
  assert.ok(picker, 'staff picker')
  assert.deepEqual(JSON.parse(picker[1]!), [
    { value: 'lan', label: 'Lan' },
    { value: 'minh', label: 'Minh' },
  ])
  assert.match(body, /stock_backend\.warehouse\.field\.userIds/)
  assert.match(body, /stock_backend\.warehouse\.userIdsHelp/)
  // What the field refused shows on it.
  assert.match(body, /"invalid":true/)
  // Refused, the field shows again with what the person picked.
  assert.match(html(warehouse.body!(modal(true, { userIds: 'minh' }))), /"values":\["minh"\]/)
  // While picking, the picker's props stay what is saved, so a pick does not remount it.
  assert.match(html(warehouse.body!(modal(true, { userIds: 'minh' }, false))), /"values":\["lan"\]/)
  const save = warehouse.commands!.save!
  const fields = { name: 'Main', code: 'WH', receptionSteps: 'one_step', deliverySteps: 'ship_only' }
  assert.deepEqual(save.input(form({ ...fields, userIds: 'lan,minh' }), modal(true), {} as never).userIds, [
    'lan',
    'minh',
  ])
  // Emptying the picker clears the staff.
  assert.deepEqual(save.input(form({ ...fields, userIds: '' }), modal(true), {} as never).userIds, [])
})

test('K15 a reader who may not edit the warehouse reads its staff by name', () => {
  const body = html(stockConfigurationDefinition('warehouse').body!(modal(false)))
  assert.match(body, /stock_backend\.warehouse\.field\.userIds/)
  assert.match(body, />Lan</)
  assert.doesNotMatch(body, /Minh/)
})

test('K15 the warehouse a new document starts in', () => {
  const wh = { id: 'wh', assigned: false }
  const hn = { id: 'hn', assigned: false }
  const mine = (row: Row) => ({ ...row, assigned: true })
  // The company's only warehouse, or the one the person is assigned to.
  assert.equal(defaultWarehouseId([wh]), 'wh')
  assert.equal(defaultWarehouseId([wh, mine(hn)]), 'hn')
  assert.equal(defaultWarehouseId([mine(wh)]), 'wh')
  // Several to choose from: none.
  assert.equal(defaultWarehouseId([wh, hn]), null)
  assert.equal(defaultWarehouseId([mine(wh), mine(hn)]), null)
  assert.equal(defaultWarehouseId([]), null)
})
