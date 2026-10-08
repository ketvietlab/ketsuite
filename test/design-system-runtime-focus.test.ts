import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachDesignSystemInteractions } from '../packages/design-system/src/runtime/index.js'
import { attachClientModalInteractions } from '../packages/design-system/src/runtime/client-modal.js'

// These objects model focus ownership and native tabbability, not layout. Real
// details/menu and modal keyboard checks also run in the catalogue browser harness.
class Element extends EventTarget {
  children: Element[] = []
  parentElement: Element | null = null
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  queries = new Map<string, Element[]>()
  ancestors = new Map<string, Element>()
  inert = false
  hidden = false
  disabled = false
  visible = true
  isConnected = true
  tabIndex: number
  readonly tag: string
  constructor(tag: string) {
    super()
    this.tag = tag
    this.tabIndex = ['a', 'button', 'input', 'summary'].includes(tag) ? 0 : -1
  }
  append(...children: Element[]): void {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
  }
  contains(node: Element | null): boolean {
    return !!node && (node === this || this.children.some((child) => child.contains(node)))
  }
  querySelector(selector: string): Element | null {
    return this.queries.get(selector)?.[0] ?? null
  }
  querySelectorAll(selector: string): Element[] {
    if (this.queries.has(selector)) return this.queries.get(selector) ?? []
    if (!selector.includes('a[href]')) return []
    const descendants = this.children.flatMap((child) => [child, ...child.descendants()])
    return descendants.filter(
      (node) =>
        ['a', 'button', 'input'].includes(node.tag) ||
        (node.tag === 'summary' && selector.includes('summary')) ||
        node.attributes.has('tabindex'),
    )
  }
  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  matches(selector: string): boolean {
    return selector.includes(':disabled') && this.disabled
  }
  closest(selector: string): Element | null {
    const mapped = this.ancestors.get(selector)
    if (mapped) return mapped
    for (let node: Element | null = this; node; node = node.parentElement) {
      if (
        (selector.includes('[inert]') && node.inert) ||
        (selector.includes('[hidden]') && node.hidden) ||
        (selector.includes('[aria-hidden="true"]') && node.getAttribute('aria-hidden') === 'true') ||
        (selector.includes('details:not([open]) > :not(summary)') && node.tag === 'closed-details-body')
      )
        return node
    }
    return null
  }
  checkVisibility(): boolean {
    return this.visible
  }
  getClientRects(): object[] {
    // Chromium can retain rects for children of a closed details element.
    return [{}]
  }
  focus(): void {
    if (!this.disabled && !this.closest('[inert]')) browserDocument.activeElement = this
  }
}

class BrowserDocument extends Element {
  activeElement: Element | null = null
  documentElement = new Element('html')
  constructor() {
    super('document')
  }
}
let browserDocument: BrowserDocument
class Key extends Event {
  readonly key: string
  readonly shiftKey: boolean
  constructor(key: string, shiftKey = false) {
    super('keydown', { cancelable: true })
    this.key = key
    this.shiftKey = shiftKey
  }
}

const browser = (run: (document: BrowserDocument, cleanup: (() => void)[]) => void): void => {
  browserDocument = new BrowserDocument()
  const globals = globalThis as Record<string, unknown>
  const replacements = {
    document: browserDocument,
    window: { matchMedia: () => Object.assign(new EventTarget(), { matches: false }) },
    HTMLElement: Element,
    HTMLDetailsElement: class extends Element {},
    HTMLInputElement: class extends Element {},
    Node: Element,
    Element,
    KeyboardEvent: Key,
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
  }
  const previous = new Map(
    Object.keys(replacements).map((name) => [name, Object.getOwnPropertyDescriptor(globals, name)]),
  )
  Object.assign(globals, replacements)
  const cleanup: (() => void)[] = []
  try {
    run(browserDocument, cleanup)
  } finally {
    for (const dispose of cleanup.reverse()) dispose()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, name, descriptor)
      else delete globals[name]
    }
  }
}
const press = (document: BrowserDocument, key: string, shiftKey = false): Key => {
  const event = new Key(key, shiftKey)
  document.dispatchEvent(event)
  return event
}

test('client modal includes a native summary and ignores closed details content in its Tab loop', () => {
  browser((document, cleanup) => {
    const root = new Element('main'),
      layer = new Element('div'),
      modal = new Element('section')
    const close = new Element('button'),
      summary = new Element('summary'),
      closed = new Element('closed-details-body')
    closed.append(new Element('a'))
    modal.append(close, summary, closed)
    layer.append(modal)
    root.append(layer)
    root.queries.set('[data-ui="modal-layer"][data-client-modal="true"]', [layer])
    layer.queries.set('[data-ui="modal-sheet"][role="dialog"]', [modal])
    cleanup.push(attachClientModalInteractions(root as unknown as HTMLElement))
    summary.focus()
    assert.equal(press(document, 'Tab').defaultPrevented, true)
    assert.ok(document.activeElement === close, 'forward Tab returns to the close button')
    assert.equal(press(document, 'Tab', true).defaultPrevented, true)
    assert.ok(document.activeElement === summary, 'reverse Tab reaches the native menu trigger')
  })
})

test('route modal skips negative tab stops, disabled controls and inert or hidden ancestor content', () => {
  browser((document, cleanup) => {
    const root = new Element('main'),
      modal = new Element('section')
    const close = new Element('a'),
      summary = new Element('summary'),
      negative = new Element('a'),
      disabled = new Element('button')
    negative.tabIndex = -1
    disabled.disabled = true
    const inert = new Element('div'),
      hidden = new Element('div'),
      ariaHidden = new Element('div')
    inert.inert = true
    hidden.hidden = true
    ariaHidden.attributes.set('aria-hidden', 'true')
    for (const parent of [inert, hidden, ariaHidden]) parent.append(new Element('button'))
    modal.append(close, summary, negative, disabled, inert, hidden, ariaHidden)
    root.append(modal)
    root.queries.set('[data-ui="modal-layer"][data-route-modal="true"] [role="dialog"]', [modal])
    cleanup.push(attachDesignSystemInteractions(root as unknown as HTMLElement))
    assert.ok(document.activeElement === close, 'mount focuses the first available control')
    assert.equal(press(document, 'Tab', true).defaultPrevented, true)
    assert.ok(document.activeElement === summary, 'reverse Tab skips non-tabbable content')
  })
})

test('disposing a runtime without a modal preserves the current focus and another owner’s inert lock', () => {
  browser((document, cleanup) => {
    const shell = new Element('div'),
      opener = new Element('button'),
      current = new Element('button')
    shell.append(opener)
    document.append(shell, current)
    document.queries.set('[data-ui="app-shell"], [data-ui="shell"]', [shell])
    opener.focus()
    const dispose = attachDesignSystemInteractions(document as unknown as Document)
    cleanup.push(dispose)
    shell.inert = true
    current.focus()
    dispose()
    assert.equal(shell.inert, true)
    assert.ok(document.activeElement === current, 'unmount leaves another owner’s focus alone')
  })
})

const tree = (document: BrowserDocument): { owner: Element; rows: Element[] } => {
  const owner = new Element('div'),
    rows = [new Element('a'), new Element('a'), new Element('a')]
  owner.append(...rows)
  document.append(owner)
  owner.queries.set('[role="treeitem"]', rows)
  for (const row of rows) {
    row.ancestors.set('[data-ui="tree"] [role="treeitem"]', row)
    row.ancestors.set('[data-ui="tree"]', owner)
  }
  return { owner, rows }
}
test('an island runtime does not handle keyboard navigation in another root', () => {
  browser((document, cleanup) => {
    const island = new Element('div'),
      { rows } = tree(document)
    document.append(island)
    cleanup.push(attachDesignSystemInteractions(island as unknown as HTMLElement))
    rows[0]?.focus()
    assert.equal(press(document, 'ArrowDown').defaultPrevented, false)
    assert.ok(document.activeElement === rows[0], 'an unrelated island does not move tree focus')
  })
})
test('overlapping document and island runtimes advance a tree by exactly one row', () => {
  browser((document, cleanup) => {
    const { owner, rows } = tree(document)
    cleanup.push(attachDesignSystemInteractions(document as unknown as Document))
    cleanup.push(attachDesignSystemInteractions(owner as unknown as HTMLElement))
    rows[0]?.focus()
    assert.equal(press(document, 'ArrowDown').defaultPrevented, true)
    assert.ok(document.activeElement === rows[1], 'one key press moves by one row')
  })
})
