import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runtime = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
const timeframe = readFileSync(
  'packages/design-system/src/data-operations/timeframe-filter/index.tsx',
  'utf8',
)
const listControls = readFileSync(
  'packages/design-system/src/data-operations/list-controls/index.tsx',
  'utf8',
)
const searchFilter = readFileSync('packages/design-system/src/interactions/search-filter/index.tsx', 'utf8')

test('design system: popups built on details close on an outside click and on Escape', () => {
  // The period filter and view settings are <details> popups, like the action menu.
  assert.match(timeframe, /<details data-ui="timeframe-menu">/u)
  assert.match(listControls, /<details data-ui="view-settings">/u)
  const declared = runtime.match(/const DISMISSIBLE_POPUPS = \[([\s\S]*?)\]\n/u)?.[1] ?? ''
  for (const hook of ['timeframe-menu', 'view-settings', 'list-filters'])
    assert.match(declared, new RegExp(`\\[data-ui="${hook}"\\]`, 'u'), `${hook} is dismissible`)

  const click = runtime.slice(
    runtime.indexOf('const onDocumentClick'),
    runtime.indexOf("document.addEventListener('click', onDocumentClick)"),
  )
  assert.match(
    click,
    /for \(const popup of root\.querySelectorAll\(DISMISSIBLE_POPUPS_OPEN\)\)[\s\S]*?!popup\.contains\(target\)\) popup\.open = false/u,
    'a click outside an open popup closes it',
  )
  assert.match(
    runtime,
    /event\.key === 'Escape' && openPopup instanceof HTMLDetailsElement\) \{\s*openPopup\.open = false/u,
    'Escape closes the open popup and returns focus to its summary',
  )
})

test("design system: folded list filters report their own open state, not a nested menu's", () => {
  assert.match(runtime, /const menuDisclosures = '\[data-ui="menu"\], \[data-ui="list-filters"\]'/u)
  assert.match(runtime, /const trigger = menu\.querySelector\(':scope > summary'\)/u)
})

// The runtime exports only attachDesignSystemInteractions, so the placement rule is read from its
// source and run against a stand-in panel; the real panels are measured in a consumer's browser.
const keepInView = runtime.slice(
  runtime.indexOf('const keepMenuPanelInView'),
  runtime.indexOf('\n}\n', runtime.indexOf('const keepMenuPanelInView')) + 2,
)
const viewport = { width: 390 }
const keepMenuPanelInView = new Function('document', `${keepInView}\nreturn keepMenuPanelInView`)({
  documentElement: {
    get clientWidth() {
      return viewport.width
    },
  },
}) as (panel: Panel, open: boolean) => void
/** A panel where its trigger puts it, moved by the shared menu CSS shift. */
class Panel {
  readonly left: number
  readonly width: number
  readonly style = {
    properties: {} as Record<string, string>,
    removeProperty(name: string) {
      delete this.properties[name]
    },
    setProperty(name: string, value: string) {
      this.properties[name] = value
    },
    getPropertyValue(name: string) {
      return this.properties[name] ?? ''
    },
  }
  constructor(left: number, width: number) {
    this.left = left
    this.width = width
  }
  getBoundingClientRect() {
    // To the micropixel, as the arithmetic of a fractional trigger edge leaves it.
    const shift = Number.parseFloat(this.style.getPropertyValue('--kv-menu-shift-inline')) || 0
    const left = Math.round((this.left + shift) * 1e6) / 1e6
    return { left, right: left + this.width }
  }
}

test('design system: a menu panel that would leave the viewport moves along the row to 8px inside it', () => {
  viewport.width = 390
  // Opening from the start of a trigger in the middle of a phone row.
  const fromStart = new Panel(208.47, 279.47)
  keepMenuPanelInView(fromStart, true)
  assert.equal(fromStart.getBoundingClientRect().left, 102, 'its leading edge on a whole pixel')
  assert.ok(fromStart.getBoundingClientRect().right <= 382, 'its trailing edge 8px inside the viewport')
  // Opening from the end of the same trigger.
  const fromEnd = new Panel(-9.34, 279.47)
  keepMenuPanelInView(fromEnd, true)
  assert.equal(fromEnd.getBoundingClientRect().left, 8)
  // A panel the viewport holds stays where its trigger put it.
  const inside = new Panel(128.88, 208)
  keepMenuPanelInView(inside, true)
  assert.equal(inside.style.getPropertyValue('--kv-menu-shift-inline'), '')
})

test('design system: a moved menu panel is placed again from its trigger, and closing forgets the move', () => {
  viewport.width = 390
  const panel = new Panel(208.47, 279.47)
  keepMenuPanelInView(panel, true)
  assert.notEqual(panel.style.getPropertyValue('--kv-menu-shift-inline'), '')
  // A wider viewport holds the panel where its trigger puts it.
  viewport.width = 768
  keepMenuPanelInView(panel, true)
  assert.equal(panel.style.getPropertyValue('--kv-menu-shift-inline'), '')
  assert.equal(panel.getBoundingClientRect().left, 208.47)
  viewport.width = 390
  keepMenuPanelInView(panel, true)
  keepMenuPanelInView(panel, false)
  assert.equal(panel.style.getPropertyValue('--kv-menu-shift-inline'), '')
})

test('design system: every menu keeps its panel in view as it opens, a menu drawn after the runtime too', () => {
  const sync = runtime.slice(runtime.indexOf('const syncMenu'), runtime.indexOf('const onMenuToggle'))
  assert.match(sync, /keepMenuPanelInView\(panel, menu\.open, clip\)/u)
  // A toggle does not bubble: only a capturing listener on the root hears a menu an island drew later.
  assert.match(runtime, /root\.addEventListener\('toggle', onMenuToggle, true\)/u)
  assert.match(
    runtime,
    /menu instanceof HTMLDetailsElement && menu\.matches\(menuDisclosures\)\) syncMenu\(menu\)/u,
  )
  // A viewport that changes while a menu is open places its panel again.
  assert.match(runtime, /window\.addEventListener\('resize', onMenuResize\)/u)
  assert.match(
    runtime.slice(runtime.indexOf('const onMenuResize')),
    /querySelectorAll\('\[data-ui="menu"\]\[open\]'\)[\s\S]*?syncMenu\(menu\)/u,
  )
  const cleanup = runtime.slice(runtime.lastIndexOf('return () => {'))
  assert.match(cleanup, /root\.removeEventListener\('toggle', onMenuToggle, true\)/u)
  assert.match(cleanup, /window\.removeEventListener\('resize', onMenuResize\)/u)
})

test('search filter: autocomplete suggestions close on an outside click without clearing the query', () => {
  const mount = searchFilter.slice(
    searchFilter.indexOf('mount: ({ root, lifetime }) => {'),
    searchFilter.indexOf('dispose: () => {'),
  )
  assert.match(
    mount,
    /document\.addEventListener\([\s\S]*?'click'/u,
    'the island owns its non-details popup dismissal',
  )
  assert.match(
    mount,
    /if \(target instanceof Node && \(root as unknown as Node\)\.contains\(target\)\) return[\s\S]*?suggestionsOpen\.set\(false\)/u,
    'only clicks outside the search filter dismiss suggestions',
  )
  assert.doesNotMatch(mount, /query\.set\(/u, 'dismissing suggestions preserves the unfinished query')
})
