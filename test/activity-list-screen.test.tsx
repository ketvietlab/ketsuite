import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { activitiesScreen } from '../packages/ketsuite/src/modules/activity_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('activity worklist exposes three collection regions and contextual Help', () => {
  const html = renderToString(
    activitiesScreen(
      translate,
      {},
      { controls: 'ACTIVITY_CONTROLS', results: 'ACTIVITY_RESULTS', footer: 'ACTIVITY_FOOTER' },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="help-drawer"/)
  assert.ok(html.indexOf('ACTIVITY_FOOTER') < html.indexOf('ACTIVITY_RESULTS'), 'pager precedes results')
  for (const part of ['ACTIVITY_CONTROLS', 'ACTIVITY_RESULTS', 'ACTIVITY_FOOTER'])
    assert.ok(html.includes(part))
})
