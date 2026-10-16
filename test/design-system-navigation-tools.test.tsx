import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { AppNavigation, AppShell } from '../packages/design-system/src/index.ts'
import {
  normalizeMenuSearch,
  filterNavigationMenu,
} from '../packages/design-system/src/runtime/navigation-tools.js'

test('navigation tools are SSR chrome with associated search and a separate rail opener', () => {
  const output = renderToString(
    AppShell({
      applications: {
        label: 'Apps',
        newTabLabel: 'New tab',
        activeId: 'sales',
        items: [],
        brand: { label: 'KetSuite', href: '/admin', image: '/brand.png' },
        navigation: { controls: 'sales-drawer', label: 'Expand menu' },
      },
      sidebar: AppNavigation({
        id: 'sales',
        label: 'Navigation',
        identity: 'Sales',
        tools: {
          searchLabel: 'Search menu',
          searchPlaceholder: 'Find a function',
          emptyLabel: 'No matches',
          collapseLabel: 'Collapse menu',
        },
        groups: [],
      }),
      main: 'Work',
    }),
  )
  assert.match(output, /data-ui="app-switcher-brand"[\s\S]*data-variant="mark"/)
  assert.match(output, /data-ui="app-switcher-expand"[^>]*aria-controls="sales-drawer"/)
  assert.match(
    output,
    /data-ui="navigation-search-toggle"[^>]*aria-controls="sales-drawer-search"[^>]*aria-expanded="false"/,
  )
  assert.match(output, /data-ui="navigation-search" id="sales-drawer-search" hidden/)
  assert.match(output, /data-ui="navigation-search-input"[^>]*aria-label="Search menu"/)
  assert.match(output, /data-ui="navigation-search-empty"[^>]*role="status"[^>]*hidden/)
})

test('menu search normalizes Vietnamese accents and preserves meaningful punctuation', () => {
  assert.equal(normalizeMenuSearch('  ĐỐI TÁC  '), 'doi tac')
  assert.equal(normalizeMenuSearch('Lô / Sê-ri'), 'lo / se-ri')
  assert.equal(normalizeMenuSearch('Sales & CRM'), 'sales & crm')
})

// This semantic tree models branch visibility/state, not CSS or browser geometry.
class MenuElement {
  hidden = false
  open = false
  children: MenuElement[] = []
  parentElement: MenuElement | null = null
  name: string | null = null
  readonly kind: string
  readonly textContent: string
  constructor(kind: string, textContent = '') {
    this.kind = kind
    this.textContent = textContent
  }
  append(child: MenuElement) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  descendants(): MenuElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }
  contains(element: MenuElement): boolean {
    return this === element || this.descendants().includes(element)
  }
  matches(selector: string): boolean {
    return selector.includes(`"${this.kind}"`)
  }
  querySelectorAll(selector: string): MenuElement[] {
    return this.descendants().filter((element) => element.matches(selector))
  }
  querySelector(): { textContent: string } {
    return { textContent: this.textContent }
  }
  getAttribute(): string | null {
    return this.name
  }
  setAttribute(_name: string, value: string) {
    this.name = value
  }
  removeAttribute() {
    this.name = null
  }
}

test('search matches ancestor labels, exposes matching branches, and restores prior open/hidden state', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLDetailsElement')
  Object.defineProperty(globalThis, 'HTMLDetailsElement', { configurable: true, value: MenuElement })
  try {
    const root = new MenuElement('navigation-groups')
    const sales = root.append(new MenuElement('navigation-branch', 'Bán hàng'))
    sales.name = 'exclusive'
    const orders = sales.append(new MenuElement('navigation-item', 'Đơn bán hàng'))
    const policies = sales.append(new MenuElement('navigation-item', 'Chính sách lập hoá đơn'))
    const stock = root.append(new MenuElement('navigation-branch', 'Kho'))
    stock.open = true
    const lots = stock.append(new MenuElement('navigation-item', 'Lô / Sê-ri'))
    const hidden = stock.append(new MenuElement('navigation-item', 'Ẩn sẵn'))
    hidden.hidden = true
    const snapshots = new Map()
    assert.equal(filterNavigationMenu(root as unknown as HTMLElement, 'ban hang', snapshots), 2)
    assert.equal(sales.open, true)
    assert.equal(sales.name, null)
    assert.equal(orders.hidden, false)
    assert.equal(stock.hidden, true)
    assert.equal(filterNavigationMenu(root as unknown as HTMLElement, 'don ban hang', snapshots), 1)
    assert.equal(orders.hidden, false)
    assert.equal(policies.hidden, true)
    assert.equal(filterNavigationMenu(root as unknown as HTMLElement, 'kho', snapshots), 1)
    assert.equal(lots.hidden, false)
    assert.equal(hidden.hidden, true)
    assert.equal(filterNavigationMenu(root as unknown as HTMLElement, 'khong-co', snapshots), 0)
    filterNavigationMenu(root as unknown as HTMLElement, '', snapshots)
    assert.equal(sales.open, false)
    assert.equal(sales.name, 'exclusive')
    assert.equal(stock.open, true)
    assert.equal(stock.hidden, false)
    assert.equal(orders.hidden, false)
    assert.equal(hidden.hidden, true)
    assert.equal(snapshots.size, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'HTMLDetailsElement', previous)
    else Reflect.deleteProperty(globalThis, 'HTMLDetailsElement')
  }
})
