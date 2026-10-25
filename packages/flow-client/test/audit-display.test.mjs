import test from 'node:test'
import assert from 'node:assert/strict'
import { auditChange } from '../client/audit-display.mjs'
import { setFlowLocale } from '../client/i18n.mjs'

test('history resolves sprint identifiers and localizes archive booleans', () => {
  const data = {
    sprints: [
      { id: 'old-sprint-id', title: 'Sprint 1' },
      { id: 'new-sprint-id', title: 'Sprint 2' },
    ],
  }
  for (const [locale, yes, no] of [
    ['en', 'Yes', 'No'],
    ['vi', 'Có', 'Không'],
    ['ja', 'はい', 'いいえ'],
  ]) {
    setFlowLocale(locale)
    assert.match(
      auditChange({ field: 'sprint', before: 'old-sprint-id', after: 'new-sprint-id' }, data),
      /Sprint 1 → Sprint 2/,
    )
    const archive = auditChange({ field: 'archived', before: false, after: true }, data)
    assert.ok(archive.endsWith(no + ' → ' + yes), archive)
    assert.ok(!archive.includes('false') && !archive.includes('true'))
  }
  setFlowLocale('en')
  assert.match(auditChange({ field: 'sprint', before: null, after: 'missing-id' }, data), /— → missing-id/)
  assert.ok(
    !auditChange(
      { field: 'description', before: 'secret old content', after: 'secret new content' },
      data,
    ).includes('secret'),
  )
})

test('task detail catalogs resolve history outside bootstrap and field changes keep their names', () => {
  setFlowLocale('en')
  const data = { tags: [], fields: [] },
    catalogs = {
      tags: [{ id: 'label-outside', title: 'Release label' }],
      fields: [{ id: 'field-outside', title: 'Release environment' }],
    }
  assert.equal(
    auditChange({ field: 'tags', before: [], after: ['label-outside'] }, data, catalogs),
    'Labels: — → Release label',
  )
  assert.equal(
    auditChange(
      {
        field: 'customFields',
        before: { 'field-outside': 'staging', unchanged: 1 },
        after: { 'field-outside': 'production', unchanged: 1 },
      },
      data,
      catalogs,
    ),
    'Release environment: staging → production',
  )
})
