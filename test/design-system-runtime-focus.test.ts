import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachDesignSystemInteractions } from '../packages/design-system/src/runtime/index.js'
import { attachClientModalInteractions } from '../packages/design-system/src/runtime/client-modal.js'
import { attachHelpDrawers } from '../packages/design-system/src/runtime/help.js'

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
  get parentNode(): Element | null {
    return this.parentElement
  }
  get nextSibling(): Element | null {
    const siblings = this.parentElement?.children ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  insertBefore(child: Element, before: Element | null): void {
    if (child.parentElement)
      child.parentElement.children = child.parentElement.children.filter((node) => node !== child)
    child.parentElement = this
    const index = before ? this.children.indexOf(before) : -1
    this.children.splice(index < 0 ? this.children.length : index, 0, child)
  }
  prepend(child: Element): void {
    this.insertBefore(child, this.children[0] ?? null)
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
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

const browser = (run: (document: BrowserDocument, cleanup: (() => void)[]) => void, mobile = false): void => {
  browserDocument = new BrowserDocument()
  const globals = globalThis as Record<string, unknown>
  const replacements = {
    document: browserDocument,
    window: Object.assign(new EventTarget(), {
      matchMedia: () => Object.assign(new EventTarget(), { matches: mobile }),
    }),
    HTMLElement: Element,
    HTMLDetailsElement: class extends Element {},
    HTMLInputElement: class extends Element {},
    HTMLButtonElement: class extends Element {},
    HTMLDialogElement: class extends Element {
      id = 'guide'
      open = false
      show(): void {
        this.open = true
      }
      showModal(): void {
        this.open = true
      }
      close(): void {
        this.open = false
      }
    },
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

test('route modal focuses the visible invalid field while preserving the modal Tab loop', () => {
  browser((document, cleanup) => {
    const root = new Element('main'),
      modal = new Element('section')
    const close = new Element('button'),
      hidden = new Element('div'),
      hiddenInvalid = new Element('input')
    const disabledInvalid = new Element('input'),
      invalid = new Element('input')
    hidden.hidden = true
    hiddenInvalid.attributes.set('aria-invalid', 'true')
    hidden.append(hiddenInvalid)
    disabledInvalid.disabled = true
    disabledInvalid.attributes.set('aria-invalid', 'true')
    invalid.attributes.set('aria-invalid', 'true')
    modal.append(close, hidden, disabledInvalid, invalid)
    root.append(modal)
    root.queries.set('[data-ui="modal-layer"][data-route-modal="true"] [role="dialog"]', [modal])
    cleanup.push(attachDesignSystemInteractions(root as unknown as HTMLElement))
    assert.ok(document.activeElement === invalid, 'validation refusal focuses the available invalid field')
    assert.equal(press(document, 'Tab').defaultPrevented, true)
    assert.ok(document.activeElement === close, 'forward Tab wraps to the close action')
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

test('mobile shell keeps the same SSR app rail inside the drawer focus loop and restores it on cleanup', () => {
  browser((document, cleanup) => {
    const shell = new Element('div')
    const rail = new Element('nav')
    const firstApp = new Element('a')
    rail.append(firstApp)
    const navigation = Reflect.construct(globalThis.HTMLDetailsElement, ['details']) as Element & {
      open: boolean
    }
    const trigger = new Element('summary')
    const drawer = new Element('div')
    const close = new Element('button')
    navigation.open = false
    navigation.append(trigger, drawer)
    drawer.append(close)
    shell.append(rail, navigation)
    document.append(shell)
    document.queries.set('[data-ui="app-shell"] > [data-ui="app-switcher"]', [rail])
    document.queries.set('[data-ui="app-navigation"]', [navigation])
    shell.queries.set('[data-ui="navigation-drawer"]', [drawer])
    navigation.queries.set('[data-ui="navigation-trigger"]', [trigger])
    navigation.queries.set('[data-ui="navigation-drawer"]', [drawer])
    navigation.ancestors.set('[data-ui="app-shell"], [data-ui="shell"]', shell)
    const dispose = attachDesignSystemInteractions(document as unknown as Document)
    cleanup.push(dispose)
    assert.equal(rail.parentElement, drawer)
    assert.equal(drawer.children[0], rail)
    navigation.open = true
    close.focus()
    const tab = press(document, 'Tab')
    assert.equal(tab.defaultPrevented, true)
    assert.equal(document.activeElement, firstApp)
    navigation.open = false
    dispose()
    cleanup.pop()
    assert.equal(rail.parentElement, shell)
    assert.equal(shell.children[0], rail)
  }, true)
})

test('screen help button emits a request hook without creating a guide drawer', () => {
  browser((document, cleanup) => {
    const help = new Element('button')
    help.ancestors.set('[data-ui="app-switcher-help"], button[name="screen-help"]', help)
    document.append(help)
    const menu = Reflect.construct(globalThis.HTMLDetailsElement, ['details']) as Element & {
      open: boolean
    }
    menu.open = true
    document.append(menu)
    document.queries.set('[data-ui="menu"][open]', [menu])
    let requests = 0
    help.addEventListener('ket:screen-help-request', (event) => {
      assert.equal((event as CustomEvent).detail.trigger, help)
      assert.equal(event.cancelable, true)
      requests += 1
    })
    cleanup.push(attachDesignSystemInteractions(document as unknown as Document))
    const click = new Event('click', { cancelable: true })
    Object.defineProperty(click, 'target', { value: help })
    document.dispatchEvent(click)
    assert.equal(requests, 1)
    assert.equal(menu.open, false)
  })
})

test('screen help resolves the current guide after content-slot navigation, including an initially empty screen', () => {
  browser((document, cleanup) => {
    const trigger = new Element('button')
    document.append(trigger)
    cleanup.push(attachHelpDrawers(document as unknown as Document))
    const guide = (id: string) => {
      const drawer = Reflect.construct(globalThis.HTMLDialogElement, ['dialog']) as Element & {
        id: string
        open: boolean
      }
      drawer.id = id
      const close = new Element('button')
      drawer.append(close)
      drawer.queries.set('[data-ui="help-close"]', [close])
      document.append(drawer)
      document.queries.set('[data-ui="help-drawer"]', [drawer])
      return { drawer, close }
    }
    const request = () => {
      const event = new Event('ket:screen-help-request', { cancelable: true })
      Object.defineProperty(event, 'target', { value: trigger })
      document.dispatchEvent(event)
      assert.equal(event.defaultPrevented, true)
    }
    const first = guide('guide')
    request()
    assert.equal(first.drawer.open, true)
    assert.equal(document.activeElement, first.close)
    first.drawer.isConnected = false
    const replacement = guide('guide')
    request()
    assert.equal(first.drawer.open, false)
    assert.equal(replacement.drawer.open, true)
    assert.equal(document.activeElement, replacement.close)
    assert.equal(press(document, 'Escape').defaultPrevented, true)
    assert.equal(replacement.drawer.open, false)
    assert.equal(document.activeElement, trigger)
    const next = guide('another-screen-guide')
    request()
    assert.equal(next.drawer.open, true)
    assert.equal(trigger.getAttribute('aria-controls'), 'another-screen-guide')
  })
})

test('standalone help restores the host navigation toggle after its menu closes', () => {
  browser((document, cleanup) => {
    const trigger = new Element('button'),
      toggle = new Element('summary')
    document.append(trigger)
    document.append(toggle)
    let menuOpen = true
    const drawer = Reflect.construct(globalThis.HTMLDialogElement, ['dialog']) as Element & {
      id: string
      open: boolean
    }
    drawer.id = 'host-guide'
    const close = new Element('button')
    drawer.append(close)
    drawer.queries.set('[data-ui="help-close"]', [close])
    document.append(drawer)
    document.queries.set('[data-ui="help-drawer"]', [drawer])
    cleanup.push(
      attachHelpDrawers(document as unknown as Document, {
        beforeOpen: (source) => {
          assert.equal(source, trigger)
          menuOpen = false
          return toggle as unknown as HTMLElement
        },
      }),
    )
    const event = new Event('ket:screen-help-request', { cancelable: true })
    Object.defineProperty(event, 'target', { value: trigger })
    document.dispatchEvent(event)
    assert.equal(menuOpen, false)
    assert.equal(drawer.open, true)
    press(document, 'Escape')
    assert.equal(drawer.open, false)
    assert.equal(document.activeElement, toggle)
  })
})

test('record help resolves its own guide even when a background screen guide was previously bound', () => {
  browser((document, cleanup) => {
    const sheet = new Element('section')
    const trigger = new Element('button')
    const guides = ['background-guide', 'record-guide'].map((id) => {
      const drawer = Reflect.construct(globalThis.HTMLDialogElement, ['dialog']) as Element & {
        id: string
        open: boolean
      }
      drawer.id = id
      const close = new Element('button')
      drawer.append(close)
      drawer.queries.set('[data-ui="help-close"]', [close])
      return drawer
    })
    document.append(guides[0]!, sheet)
    sheet.append(trigger, guides[1]!)
    trigger.ancestors.set('[data-ui="modal-sheet"], [data-ui="record-page"], [data-ui="peek"]', sheet)
    trigger.setAttribute('aria-controls', 'background-guide')
    document.queries.set('[data-ui="help-drawer"]', guides)
    cleanup.push(attachHelpDrawers(document as unknown as Document))
    const request = new Event('ket:screen-help-request', { cancelable: true })
    Object.defineProperty(request, 'target', { value: trigger })
    document.dispatchEvent(request)
    assert.equal(guides[0]!.open, false)
    assert.equal(guides[1]!.open, true)
    press(document, 'Escape')
    assert.equal(guides[1]!.open, false)
    assert.equal(document.activeElement, trigger)
  })
})

test('a record page without its own guide opens the screen guide rendered beside it', () => {
  browser((document, cleanup) => {
    const page = new Element('section')
    const trigger = new Element('button')
    const drawer = Reflect.construct(globalThis.HTMLDialogElement, ['dialog']) as Element & {
      id: string
      open: boolean
    }
    drawer.id = 'screen-guide'
    const close = new Element('button')
    drawer.append(close)
    drawer.queries.set('[data-ui="help-close"]', [close])
    document.append(page, drawer)
    page.append(trigger)
    trigger.ancestors.set('[data-ui="modal-sheet"], [data-ui="record-page"], [data-ui="peek"]', page)
    trigger.setAttribute('aria-controls', 'screen-guide')
    document.queries.set('[data-ui="help-drawer"]', [drawer])
    cleanup.push(attachHelpDrawers(document as unknown as Document))
    const request = new Event('ket:screen-help-request', { cancelable: true })
    Object.defineProperty(request, 'target', { value: trigger })
    document.dispatchEvent(request)
    assert.equal(request.defaultPrevented, true)
    assert.equal(drawer.open, true)
    press(document, 'Escape')
    assert.equal(drawer.open, false)
    assert.equal(document.activeElement, trigger)
  })
})

test('screen help closes when the reader presses outside it, not inside it or on its own trigger', () => {
  browser((document, cleanup) => {
    const trigger = new Element('button')
    trigger.ancestors.set('[data-ui="app-switcher-help"], button[name="screen-help"]', trigger)
    const card = new Element('a')
    const drawer = Reflect.construct(globalThis.HTMLDialogElement, ['dialog']) as Element & { open: boolean }
    const close = new Element('button')
    const text = new Element('p')
    drawer.append(close, text)
    drawer.queries.set('[data-ui="help-close"]', [close])
    document.append(trigger, card, drawer)
    document.queries.set('[data-ui="help-drawer"]', [drawer])
    cleanup.push(attachHelpDrawers(document as unknown as Document))
    const open = () => {
      const event = new Event('ket:screen-help-request', { cancelable: true })
      Object.defineProperty(event, 'target', { value: trigger })
      document.dispatchEvent(event)
      assert.equal(drawer.open, true)
    }
    const pointer = (target: Element, button = 0) => {
      const event = Object.assign(new Event('pointerdown'), { button })
      Object.defineProperty(event, 'target', { value: target })
      document.dispatchEvent(event)
    }
    open()
    pointer(text)
    pointer(drawer)
    assert.equal(drawer.open, true, 'inside the guide')
    pointer(trigger)
    assert.equal(drawer.open, true, '? toggles the guide itself')
    pointer(card, 2)
    assert.equal(drawer.open, true, 'a secondary button is not a dismissal')
    pointer(card)
    assert.equal(drawer.open, false)
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.notEqual(document.activeElement, trigger, 'the pointer owns focus after a dismissal')
    open()
    assert.equal(drawer.open, true, 'it opens again after an outside dismissal')
  })
})

test('Escape dismisses a settings menu before its containing mobile navigation drawer', () => {
  browser((document, cleanup) => {
    const navigation = Reflect.construct(globalThis.HTMLDetailsElement, ['details']) as Element & {
      open: boolean
    }
    const drawer = new Element('div')
    const menu = Reflect.construct(globalThis.HTMLDetailsElement, ['details']) as Element & { open: boolean }
    const trigger = new Element('summary')
    navigation.open = false
    menu.open = false
    navigation.append(drawer)
    drawer.append(menu)
    menu.append(trigger)
    document.append(navigation)
    document.queries.set('[data-ui="app-navigation"]', [navigation])
    navigation.queries.set('[data-ui="navigation-drawer"]', [drawer])
    menu.queries.set('[data-ui="menu-trigger"]', [trigger])
    cleanup.push(attachDesignSystemInteractions(document as unknown as Document))
    navigation.open = true
    menu.open = true
    trigger.ancestors.set('[data-ui="menu"][open]', menu)
    trigger.focus()
    const escapeEvent = press(document, 'Escape')
    assert.equal(escapeEvent.defaultPrevented, true)
    assert.equal(menu.open, false)
    assert.equal(navigation.open, true)
    assert.equal(document.activeElement, trigger)
    trigger.ancestors.delete('[data-ui="menu"][open]')
    press(document, 'Escape')
    assert.equal(navigation.open, false)
  }, true)
})
