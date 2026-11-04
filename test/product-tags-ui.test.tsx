import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { tagModalDefinition as definition } from '../packages/ketsuite/src/modules/product_backend/modal/tag-modal-view.tsx'
import { tagQuery } from '../packages/ketsuite/src/modules/product_backend/tags/shared.ts'
import type { TagModalData } from '../packages/ketsuite/src/modules/product_backend/tags/shared.ts'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
const data: TagModalData = {
  lang: 'en',
  record: { id: 'tag', name: 'Tag', active: true, revisionId: 'revision' },
  permissions: { edit: true, lifecycle: true },
  usage: { products: 1, names: ['Product'] },
}
const context = (permissions = data.permissions): RecordModalContext<TagModalData> => ({
  id: 'tag',
  kind: 'product.tag',
  creating: false,
  tab: '',
  data: { ...data, permissions },
  t: (key) => key,
  outcome: () => null,
  fieldError: (name) =>
    name === 'name' ? 'Duplicate name' : name === 'expectedRevisionId' ? 'Reload before saving' : null,
  draft: (name, fallback = '') => (name === 'name' ? '  Draft raw  ' : fallback),
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (_key, fallback = '') => fallback,
})
const render = (value: unknown) => renderToString(value as TemplateResult)
test('tag form retains refused raw input, field feedback and revision; lifecycle commands bypass name input', () => {
  const c = context(),
    html = render(definition.body!(c))
  assert.ok(html.includes('value="  Draft raw  "'))
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /data-layout="inline"/)
  assert.match(html, /Duplicate name/)
  assert.match(html, /Reload before saving/)
  const form = new FormData()
  form.set('name', '  Draft raw  ')
  assert.deepEqual(definition.commands!.save!.input!(form, c, {}), {
    id: 'tag',
    expectedRevisionId: 'revision',
    name: '  Draft raw  ',
  })
  for (const name of ['archive', 'restore'] as const) {
    assert.deepEqual(definition.commands![name]!.input!(new FormData(), c, {}), {
      id: 'tag',
      active: name === 'restore',
      expectedRevisionId: 'revision',
    })
    assert.equal(definition.commands![name]!.after, 'reload')
    assert.ok(definition.dialogs![name]!.confirmation)
  }
})
test('read-only and archived tag records expose facts without write controls', () => {
  const c = context({ edit: false, lifecycle: false })
  assert.doesNotMatch(render(definition.body!(c)), /<input|<select/)
  assert.doesNotMatch(render(definition.actions!(c)), /type="submit"|tag\.archive|tag\.restore/)
  const archived = context({ edit: false, lifecycle: true })
  archived.data.record = { ...data.record, active: false }
  assert.doesNotMatch(render(definition.body!(archived)), /<input/)
  assert.match(render(definition.actions!(archived)), /tag\.restore/)
})
test('tag list query keeps filters and bounds pages while excluding record and dialog state', () => {
  const query = tagQuery(
    new URL(
      'http://local/admin/product/tags?lang=en&company=acme&status=archived&q=do&record=product.tag%3Atag&dialog=archive&page=2&pageSize=900',
    ),
  )
  assert.equal(query.pageSize, 100)
  assert.equal(query.page, 2)
  assert.match(query.href, /company=acme/)
  assert.match(query.href, /status=archived/)
  assert.doesNotMatch(query.href, /record=|dialog=/)
})
