import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
  process.env.KET_MENU_MUTATION_SOURCE || 'packages/design-system/src/runtime/index.js',
  'utf8',
)
// Exercise placement with its clipping helper and observer lifetime, excluding
// document listeners: menus are discovered through delegated toggle events.
const fitStart = source.indexOf('const menuProperties =')
const fitEnd = source.indexOf('const onMenuToggle =', fitStart)
assert.ok(fitStart >= 0 && fitEnd > fitStart, 'extract the current menu lifecycle')
const fit =
  source.slice(source.indexOf('const keepMenuPanelInView ='), source.indexOf('const DISMISSIBLE_POPUPS =')) +
  source.slice(fitStart, fitEnd)

type Rect = { left: number; top: number; width: number; height: number }
function fixture(width: number, height: number, anchor: Rect, clip?: Rect) {
  class Element {
    parentElement: Element | null = null
    ownerDocument = { documentElement: { clientWidth: width, clientHeight: height } }
    attributes = new Map<string, string>()
    properties = new Map<string, string>()
    dataset = { placement: 'bottom' }
    open = true
    style = {
      setProperty: (key: string, value: string) => {
        this.properties.set(key, value)
      },
      removeProperty: (key: string) => {
        this.properties.delete(key)
      },
    }
    readonly rect: Rect
    readonly kind: 'anchor' | 'panel' | 'clip' | 'menu'
    constructor(rect: Rect, kind: 'anchor' | 'panel' | 'clip' | 'menu') {
      this.rect = rect
      this.kind = kind
    }
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value)
    }
    querySelector(selector: string) {
      return selector.includes('summary') ? trigger : panel
    }
    getBoundingClientRect() {
      const panelWidth =
        this.kind === 'panel'
          ? Math.min(
              this.rect.width,
              width - 32,
              Number.parseFloat(this.properties.get('--kv-menu-available-inline') || 'Infinity'),
            )
          : this.rect.width
      const panelHeight = Math.min(
        this.rect.height,
        Number.parseFloat(this.properties.get('--kv-menu-available-block') || 'Infinity'),
      )
      const left = this.rect.left + Number.parseFloat(this.properties.get('--kv-menu-shift-inline') || '0')
      const top = this.rect.top + Number.parseFloat(this.properties.get('--kv-menu-shift-block') || '0')
      return {
        left,
        top,
        width: panelWidth,
        height: panelHeight,
        right: left + panelWidth,
        bottom: top + panelHeight,
      }
    }
  }
  const trigger = new Element(anchor, 'anchor')
  const panel = new Element(
    { left: anchor.left, top: anchor.top + anchor.height + 4, width: 465, height: 448 },
    'panel',
  )
  const menu = new Element(anchor, 'menu')
  menu.parentElement = clip ? new Element(clip, 'clip') : null
  runInNewContext(`${fit}; syncMenu(menu)`, {
    menu,
    HTMLElement: Element,
    getComputedStyle: (element: Element) => ({
      overflowX: element.kind === 'clip' ? 'auto' : 'visible',
      overflowY: element.kind === 'clip' ? 'auto' : 'visible',
      fontSize: '16px',
      getPropertyValue: (key: string) => (key === '--kv-space-2' ? '.5rem' : '.25rem'),
    }),
  })
  return {
    panel,
    menu,
    trigger,
    fit: () =>
      runInNewContext(`${fit}; syncMenu(menu)`, {
        menu,
        HTMLElement: Element,
        getComputedStyle: () => ({
          overflowX: 'visible',
          overflowY: 'visible',
          getPropertyValue: () => '8px',
        }),
      }),
  }
}

test('menu placement fits long choices inside the mobile viewport and desktop scroll region', () => {
  for (const setup of [
    fixture(360, 800, { left: 104, top: 360, width: 124, height: 36 }),
    fixture(
      1440,
      900,
      { left: 1228, top: 700, width: 124, height: 32 },
      { left: 1120, top: 120, width: 320, height: 780 },
    ),
  ]) {
    const bounds = setup.panel.getBoundingClientRect()
    const clip = setup.menu.parentElement?.rect || { left: 0, top: 0, width: 360, height: 800 }
    assert.ok(bounds.left >= clip.left + 8)
    assert.ok(bounds.right <= clip.left + clip.width - 8)
    assert.ok(bounds.top >= clip.top + 8)
    assert.ok(bounds.bottom <= clip.top + clip.height - 8)
    assert.equal(setup.trigger.attributes.get('aria-expanded'), 'true')
  }
})

test('closing a fitted menu clears measured geometry and collapsed semantics', () => {
  const setup = fixture(360, 800, { left: 104, top: 720, width: 124, height: 36 })
  setup.menu.open = false
  setup.fit()
  assert.equal(setup.panel.properties.size, 0)
  assert.equal(setup.trigger.attributes.get('aria-expanded'), 'false')
})
