import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { attachPeekInteractions } from '../packages/design-system/src/runtime/peek.js'

// The focus lifetime needs a few browser objects, not a renderer. Real keyboard and
// layout evidence is recorded with the consumer screen in the browser.
type Listener = (event: Record<string, unknown>) => void
const globals = globalThis as Record<string, unknown>
const saved = ['document', 'MutationObserver', 'CSS', 'getComputedStyle'].map((name) => [name, globals[name]])

class Node {
  readonly name: string
  isConnected = true
  matchesSelector: string[] = []
  scrolled = 0
  constructor(name: string, ...selectors: string[]) {
    this.name = name
    this.matchesSelector = selectors
  }
  closest(selector: string): Node | null {
    return this.matchesSelector.includes(selector) ? this : null
  }
  focus(): void {
    doc.activeElement = this
    for (const listener of doc.listeners.focusin ?? []) listener({ target: this })
  }
  click(): void {
    clicks.push(this.name)
  }
  scrollIntoView(): void {
    this.scrolled += 1
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 0 }
  }
}

let clicks: string[] = []
let observe: () => void = () => {}
let layerAbove = false
let asidePosition = 'static'
const body = new Node('body')
const doc = {
  activeElement: body as Node | null,
  body,
  listeners: {} as Record<string, Listener[]>,
  querySelector: () => (layerAbove ? new Node('modal') : null),
  addEventListener: (type: string, listener: Listener) => {
    doc.listeners[type] = [...(doc.listeners[type] ?? []), listener]
  },
  removeEventListener: (type: string, listener: Listener) => {
    doc.listeners[type] = (doc.listeners[type] ?? []).filter((item) => item !== listener)
  },
}

const ID = 'reservation-peek'
const invokerSelector = `[aria-controls="${ID}"]`
const closeSelector = `#${ID}-close`

const setup = (initiallyOpen = false) => {
  const close = new Node('close', closeSelector)
  const panel = Object.assign(new Node('panel'), { querySelector: () => close })
  const bar = new Node('bar', invokerSelector)
  const other = new Node('other', invokerSelector)
  const makeAside = (open: boolean) => ({
    current: open ? panel : null,
    // The place owns the id; only the panel hook finds the current content.
    querySelector(selector: string) {
      return selector === '[data-ui="peek"]' ? this.current : null
    },
    contains: (node: Node) => node === panel || node === close,
  })
  // The item the view marks with aria-current; a page that loads open marks `other`.
  const view = { marked: (initiallyOpen ? other : null) as Node | null }
  let aside = makeAside(initiallyOpen)
  const handlers: Listener[] = []
  const layout = {
    dataset: { peekId: ID },
    querySelector: (selector: string) =>
      selector.startsWith(':scope') ? aside : selector.includes('aria-current') ? view.marked : null,
    contains: (node: Node | null) => node === bar || node === other || node === panel || node === close,
    addEventListener: (_: string, listener: Listener) => handlers.push(listener),
    removeEventListener: () => {},
  }
  const dispose = attachPeekInteractions(layout as unknown as HTMLElement)
  const render = (open: boolean) => {
    aside.current = open ? panel : null
    if (!open) view.marked = null
    observe()
  }
  const press = (target: Node, key?: string) => {
    for (const handler of handlers) handler(key ? { key, target } : { target })
    if (target === bar || target === other) view.marked = target
  }
  const pressEscape = () => {
    const event = {
      key: 'Escape',
      defaultPrevented: false,
      preventDefault: () => (event.defaultPrevented = true),
    }
    for (const listener of doc.listeners.keydown ?? []) listener(event)
    return event.defaultPrevented
  }
  return {
    bar,
    other,
    panel,
    close,
    view,
    render,
    press,
    pressEscape,
    dispose,
    replaceAside: (open: boolean) => {
      aside = makeAside(open)
      observe()
    },
  }
}

beforeEach(() => {
  clicks = []
  layerAbove = false
  asidePosition = 'static'
  doc.activeElement = body
  doc.listeners = {}
  globals.document = doc
  globals.CSS = { escape: (value: string) => value }
  globals.getComputedStyle = () => ({ position: asidePosition })
  globals.MutationObserver = class {
    constructor(callback: () => void) {
      observe = callback
    }
    observe(): void {}
    disconnect(): void {}
  }
})

afterEach(() => {
  for (const [name, value] of saved) globals[name as string] = value
})

test('opening from an invoker focuses the panel; a page that loads open does not steal focus', () => {
  const loaded = setup(true)
  loaded.render(true)
  assert.equal(doc.activeElement, body)
  loaded.dispose()

  const peek = setup()
  peek.bar.focus()
  peek.press(peek.bar, 'Enter')
  peek.render(true)
  assert.equal(doc.activeElement, peek.panel)
})

test('a peek opened by history, not by an invoker, leaves focus where it is', () => {
  const peek = setup()
  peek.render(true)
  assert.equal(doc.activeElement, body)
})

test('the application closing the peek while focus is inside returns focus to the invoker', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  peek.close.focus()
  // A command finished and the island removed the peek: focus fell to <body>.
  doc.activeElement = body
  peek.render(false)
  assert.equal(doc.activeElement, peek.bar)
})

test('another invoker replaces the content without moving focus out of the view', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  peek.other.focus()
  peek.press(peek.other)
  peek.render(true)
  assert.equal(doc.activeElement, peek.other)
})

test('Escape closes through the close control and focus returns to the invoker', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  assert.equal(peek.pressEscape(), true)
  assert.deepEqual(clicks, ['close'])
  peek.render(false)
  assert.equal(doc.activeElement, peek.bar)
})

test('Escape belongs to a dialog or popup above the peek, and to nobody outside the layout', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  layerAbove = true
  assert.equal(peek.pressEscape(), false)
  layerAbove = false
  doc.activeElement = new Node('elsewhere')
  assert.equal(peek.pressEscape(), false)
  assert.deepEqual(clicks, [])
})

test('closing after the invoker was re-rendered returns focus to the current item', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  peek.bar.isConnected = false
  peek.view.marked = peek.other
  peek.press(peek.close)
  peek.render(false)
  assert.equal(doc.activeElement, peek.other)
})

test('after paging, Escape returns focus to the item now shown, not the first invoker', () => {
  // No invoker was ever pressed, and the view unmarks its item before the peek leaves the DOM.
  const peek = setup(true)
  peek.close.focus()
  assert.equal(peek.pressEscape(), true)
  peek.render(false)
  assert.equal(doc.activeElement, peek.other)

  // Opened from one item, paged to the next: Escape goes back to the item on screen.
  const paged = setup()
  paged.press(paged.bar)
  paged.render(true)
  paged.view.marked = paged.other
  paged.render(true)
  assert.equal(paged.pressEscape(), true)
  paged.render(false)
  assert.equal(doc.activeElement, paged.other)
})

test('a close the user asked for does not decide where a later application close returns', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  peek.pressEscape()
  peek.render(false)
  peek.press(peek.other)
  peek.render(true)
  peek.close.focus()
  doc.activeElement = body
  peek.render(false)
  assert.equal(doc.activeElement, peek.other)
})

test('a re-render that drops the focused control keeps focus in the panel, and only then', () => {
  const peek = setup()
  peek.press(peek.bar)
  peek.render(true)
  peek.close.focus()
  doc.activeElement = body
  peek.render(true)
  assert.equal(doc.activeElement, peek.panel)

  // Focus that was never in the peek (a page that loaded open) is left alone on a refresh.
  const loaded = setup(true)
  doc.activeElement = body
  loaded.render(true)
  assert.equal(doc.activeElement, body)
})

test('a Back navigation that removes the peek leaves focus alone unless it was inside', () => {
  const peek = setup(true)
  peek.bar.focus()
  doc.activeElement = body
  peek.render(false)
  assert.equal(doc.activeElement, body)
})

test('where the peek is a sheet, the invoker is scrolled out from under it', () => {
  asidePosition = 'fixed'
  const peek = setup()
  peek.bar.getBoundingClientRect = () => ({ top: 600, bottom: 640 })
  peek.panel.getBoundingClientRect = () => ({ top: 400, bottom: 800 })
  peek.press(peek.bar)
  peek.render(true)
  assert.equal(peek.bar.scrolled, 1)
})

test('a reactive island can replace the aside without losing opening, Escape or focus return', () => {
  const peek = setup()
  peek.bar.focus()
  peek.press(peek.bar)
  peek.replaceAside(true)
  assert.equal(doc.activeElement, peek.panel)
  peek.close.focus()
  assert.equal(peek.pressEscape(), true)
  assert.deepEqual(clicks, ['close'])
  doc.activeElement = body
  peek.replaceAside(false)
  assert.equal(doc.activeElement, peek.bar)
  peek.dispose()
})
