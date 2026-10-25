import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createSearchFilterView } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../packages/design-system/src/interactions/search-filter/demo.ts'

test('expanded search filter exposes labelled quick controls and opens the rule editor only on request', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'expanded-filter',
      config: { ...searchFilterDemoConfig, presentation: 'expanded' },
    }).view(),
  )
  assert.match(html, /data-presentation="expanded"/)
  assert.match(html, /data-ui="search-filter-expanded" role="group" aria-label="Filters"/)
  assert.doesNotMatch(html, /data-ui="custom-filter"/)
  assert.match(html, /data-ui="search-filter-rule-toggle"[^>]*aria-expanded="false"/)
  assert.match(html, /aria-controls="expanded-filter-groupBy-panel"/)
  assert.match(html, /aria-controls="expanded-filter-favorite-panel"/)
  assert.match(html, /<summary[^>]*data-section="groupBy"[\s\S]*?Customer/)
  assert.doesNotMatch(html, /data-ui="search-filter-toggle"/)
  assert.equal((html.match(/data-ui="custom-group-by"/g) ?? []).length, 0)
  assert.doesNotMatch(html, /data-ui="search-filter-facet"/)
})

test('expanded search filter respects unsupported grouping and saved-search capabilities', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'expanded-presets',
      config: {
        ...searchFilterDemoConfig,
        presentation: 'expanded',
        capabilities: { groupBy: false, favorites: false, customFilters: false },
      },
    }).view(),
  )
  assert.match(html, /data-ui="search-filter-expanded"/)
  assert.doesNotMatch(
    html,
    /data-section="groupBy"|data-section="favorite"|data-ui="custom-filter"|data-ui="search-filter-rule-toggle"/,
  )
})

test('expanded preset groups use consumer labels without changing option IDs or active state', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'labelled-presets',
      config: {
        ...searchFilterDemoConfig,
        presentation: 'expanded',
        filters: [{ id: 'open', label: 'Open', active: true, group: 'state', groupLabel: 'Status' }],
      },
    }).view(),
  )
  assert.match(html, /data-ui="menu-panel" role="group" aria-label="Status"/)
  assert.match(html, /<summary[\s\S]*?Status:[\s\S]*?Open/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /Open/)
})

test('omitting presentation preserves the existing compact popup contract', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'legacy-filter',
      config: searchFilterDemoConfig,
    }).view(),
  )
  assert.match(html, /data-presentation="compact"/)
  assert.match(html, /data-ui="search-filter-toggle"/)
  assert.doesNotMatch(html, /data-ui="search-filter-expanded"/)
})

test('expanded selected controls expose the complete long value through a native tooltip', () => {
  const label = 'A very long saved filter that retains its complete accessible value and privacy context'
  const html = renderToString(
    createSearchFilterView({
      id: 'long-selection',
      config: {
        ...searchFilterDemoConfig,
        presentation: 'expanded',
        facets: [{ id: 'long', type: 'favorite', label }],
        favorites: [{ id: 'long', label, active: true, isDefault: false }],
      },
    }).view(),
  )
  assert.ok(html.includes(`title="Favorites: ${label}"`))
  assert.ok(html.includes(label))
})

test('search filter: active groups render in the chip row and retain their ordered pipeline', () => {
  const html = renderToString(
    createSearchFilterView({ id: 'search-filter-grouping-test', config: searchFilterDemoConfig }).view(),
  )

  assert.match(html, /data-ui="search-filter-grouping"/)
  assert.match(html, /data-ui="search-filter-grouping-order">[\s\S]*?1</)
  assert.match(html, /data-ui="search-filter-grouping-label">[\s\S]*?Customer/)
  assert.match(html, /data-ui="search-filter-grouping-clear"[\s\S]*?Clear all/)
  assert.match(
    html,
    /data-ui="search-filter-facet" data-type="groupBy"/,
    'grouping is visible outside the popup without consuming the search input',
  )
})

test('search filter: compact is an explicit public density variant', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'search-filter-compact-test',
      config: { ...searchFilterDemoConfig, size: 'compact' },
    }).view(),
  )

  assert.match(html, /data-ui="search-filter"[^>]*data-size="compact"/)
})

test('search filter: layout is constrained by the component container, not application chrome', async () => {
  const styles = await readFile('packages/design-system/src/interactions/search-filter/styles.css', 'utf8')

  assert.match(styles, /@container search-filter/)
  assert.doesNotMatch(styles, /kv-sidebar-width|data-ui="app-main"/)
})

test('search filter: backend does not override private popup geometry or main stacking', async () => {
  const styles = await readFile('packages/ketsuite/src/modules/backend/design/lists.css', 'utf8')

  assert.doesNotMatch(styles, /data-variant="search-filter"/)
})

test('search filter: reaching the grouping limit disables new groups but keeps removal available', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'limited-filter',
      config: {
        ...searchFilterDemoConfig,
        maxGroupBy: 1,
      },
    }).view(),
  )
  assert.match(html, /data-ui="custom-group-by"[^>]*disabled/)
  assert.match(html, /data-ui="search-filter-grouping-clear"[^>]*type="button"/)
  assert.doesNotMatch(html, /role="menuitemcheckbox"|role="menu"/)
})
