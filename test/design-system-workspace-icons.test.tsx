import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Icon, type IconName } from '../packages/design-system/src/primitives/icon/index.js'

test('workspace, company, application and theme icons preserve public accessible/decorative contracts', () => {
  const names: IconName[] = ['layers-3', 'building-2', 'layout-grid', 'sun', 'moon']
  const results = new Set<string>()
  for (const name of names) {
    const decorative = renderToString(<Icon name={name} />)
    assert.match(decorative, /viewBox="0 0 24 24"/)
    assert.match(decorative, /aria-hidden="true"/)
    assert.doesNotMatch(decorative, /role="img"/)
    assert.match(decorative, /<(?:path|circle|rect) /)
    results.add(decorative)
    const labeled = renderToString(<Icon name={name} label={name} />)
    assert.match(labeled, /role="img"/)
    assert.ok(labeled.includes(`aria-label="${name}"`))
    assert.doesNotMatch(labeled, /aria-hidden="true"/)
  }
  assert.equal(results.size, names.length)
})
