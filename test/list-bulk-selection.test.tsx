import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ListPage as PublicListPage } from '../packages/design-system/src/patterns/list-page/index.tsx'
import { productsScreen } from '../packages/ketsuite/src/modules/product_backend/screens/list.tsx'
import { page, selection, translate } from './helpers/list-bulk-page.tsx'

// The same slots in a real browser: test/browser/list-bulk-selection.test.tsx.
test('bulk-only slots hide on the server through nested empty extension fragments; real extras stay visible', () => {
  // biome-ignore lint/complexity/noUselessFragments: Regression fixtures intentionally include empty and nested fragment results.
  for (const extra of [undefined, null, false, '', [], <></>, <>{[null, [], <></>]}</>]) {
    const html = renderToString(page('bulk', extra))
    assert.match(html, /data-ui="list-page-tools" hidden/)
    assert.match(html, /data-ui="bulk-form" id="bulk"[^>]* hidden/)
    assert.match(html, /data-ui="row-select" form="bulk"/)
    assert.match(html, /name="token" value="preserved"/)
    assert.match(
      html,
      /data-ui="list-page-header"[\s\S]*?href="\/new"[\s\S]*?data-ui="list-page-tools"[\s\S]*?data-ui="bulk-form"/,
    )
    const afterHeader = html.slice(html.indexOf('</header>'))
    assert.doesNotMatch(afterHeader, /data-ui="(?:list-page-actions|list-page-tools|bulk-form)"/)
    const product = renderToString(
      productsScreen(translate, { chrome: { selection: selection('products') } }, null, extra),
    )
    assert.match(product, /data-ui="list-page-tools" hidden/)
  }
  for (const extra of [
    <button type="button">Export</button>,
    <>Export</>,
    [null, <a href="/export">Export</a>],
  ])
    assert.doesNotMatch(renderToString(page('bulk', extra)), /data-ui="list-page-tools" hidden/)
  const noPrimary = renderToString(page('no-primary', undefined, null))
  assert.doesNotMatch(noPrimary, /href="\/new"/)
  assert.match(noPrimary, /data-ui="list-page-actions"[^>]* hidden/)
  const customPrimary = renderToString(page('custom', undefined, <button type="button">Custom</button>))
  assert.doesNotMatch(customPrimary, /href="\/new"/)
  assert.match(customPrimary, /Custom[\s\S]*?data-ui="list-page-tools" hidden/)
  const unadorned = renderToString(
    <PublicListPage
      title="Embedded"
      actionsHidden
      actions={<button type="button">Create</button>}
      body="Rows"
    />,
  )
  assert.doesNotMatch(unadorned, /data-ui="list-page-tools" hidden/)
})
