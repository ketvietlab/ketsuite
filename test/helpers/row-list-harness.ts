// A browser stand-in for the collection islands (ui/client/row-list-island.tsx): history,
// location, fetch and the shell's events, with the three islands of one list mounted over
// it. Reads are answered by `answerFor`, and every read and history write is recorded.
import { setMaxListeners } from 'node:events'
import type { TestContext } from 'node:test'
import { effect, renderToString } from '@ketvietlab/ketjs-view'
import {
  rowList,
  rowListControls,
  rowListFooter,
  type RowListProps,
} from '../../packages/ketsuite/src/ui/client/row-list-island.tsx'
import type { RowListAnswer } from '../../packages/ketsuite/src/modules/backend/row-list-read.ts'

export class ElementFixture extends EventTarget {
  querySelector(): null {
    return null
  }
  querySelectorAll(): never[] {
    return []
  }
  contains(): boolean {
    return false
  }
  closest(_selector: string): unknown {
    return null
  }
}

/** A link, either the link of the list row `row` (standing in for the row too) or anywhere else in the island. */
export class AnchorFixture extends ElementFixture {
  href: string
  readonly dataset: Record<string, string>
  constructor(href: string, row?: string) {
    super()
    this.href = href
    this.dataset = row ? { row } : {}
  }
  override closest(selector: string): unknown {
    if (selector === 'a[href]') return this
    if (selector === '[data-ui="kt-row"]') return this.dataset.row ? this : null
    return null
  }
  getAttribute(name: string): string | null {
    return name === 'href' ? this.href : null
  }
  setAttribute(name: string, value: string): void {
    if (name === 'href') this.href = value
  }
  getBoundingClientRect() {
    return { top: 120, left: 0, height: 40, width: 800 }
  }
}

/** The retry button, found by its id. */
class ButtonFixture extends ElementFixture {
  readonly id: string
  constructor(id: string) {
    super()
    this.id = id
  }
  override closest(selector: string): unknown {
    return selector === `#${this.id}` ? this : null
  }
}

export type Reply = (href: string) => Promise<Response>

export const settled = () => new Promise<void>((resolve) => setImmediate(resolve))
export const shownRows = (markup: string) =>
  [...markup.matchAll(/data-ui="kt-row" data-row="([^"]+)"/g)].map((match) => match[1])

export const rowListHarness = (
  t: TestContext,
  props: (href: string) => RowListProps,
  answerFor: (href: string) => RowListAnswer,
  start: string,
  /** The list the server rendered, when the address is still the page being left. */
  rendered?: string,
) => {
  const origin = 'http://ket.local'
  let current = new URL(start, origin)
  const entries = [current.href]
  let position = 0
  const writes: Array<['push' | 'replace', string]> = []
  const reads: string[] = []
  const calls: Array<{ path: string; body: unknown }> = []
  let reply: Reply = async (href) => Response.json({ ok: true, value: answerFor(href) })
  let callReply: (path: string, body: unknown) => unknown = () => ({})
  const fields = new Map<string, unknown>()
  const doc = Object.assign(new EventTarget(), {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id: string) => fields.get(id) ?? null,
  })
  const win = new EventTarget()
  const online = { onLine: true }
  const globals: Record<string, unknown> = {
    document: doc,
    window: win,
    navigator: online,
    location: {
      get href() {
        return current.href
      },
      get origin() {
        return origin
      },
      get pathname() {
        return current.pathname
      },
      get search() {
        return current.search
      },
      get hash() {
        return current.hash
      },
    },
    history: {
      state: null,
      pushState(_state: unknown, _title: string, url: string) {
        current = new URL(url, origin)
        entries.splice(++position, entries.length, current.href)
        writes.push(['push', `${current.pathname}${current.search}`])
      },
      replaceState(_state: unknown, _title: string, url: string) {
        current = new URL(url, current)
        entries[position] = current.href
        writes.push(['replace', `${current.pathname}${current.search}`])
      },
    },
    requestAnimationFrame: (callback: () => void) => setImmediate(callback),
    CSS: { escape: (value: string) => value },
    fetch: async (url: unknown, init: RequestInit) => {
      const path = String(url)
      const body = JSON.parse(String(init.body)) as { href?: unknown }
      if (path.startsWith('/_ket/fn/')) {
        calls.push({ path, body })
        return Response.json({ ok: true, value: callReply(path, body) })
      }
      const href = String(body.href)
      reads.push(href)
      return reply(href)
    },
  }
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const lifetime = new AbortController()
  setMaxListeners(40, lifetime.signal)
  const root = new ElementFixture()
  const controlsRoot = new ElementFixture()
  const served = new URL(rendered ?? start, origin)
  for (const key of ['record', 'tab', 'dialog']) served.searchParams.delete(key)
  // The three islands of one list share a store, so a link followed in any of them is the list's.
  const parts = [rowListControls, rowList, rowListFooter].map((part) =>
    part(props(`${served.pathname}${served.search}`)),
  )
  let markup = ''
  const stop = effect(() => {
    markup = parts.map((part) => renderToString(part.view())).join('')
  })
  t.after(() => {
    lifetime.abort()
    for (const part of parts) part.dispose?.()
    stop()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const [controls, results, footer] = parts
  controls!.mount!({ root: controlsRoot as never, lifetime: lifetime.signal } as never)
  results!.mount!({ root: root as never, lifetime: lifetime.signal } as never)
  footer!.mount!({ root: new ElementFixture() as never, lifetime: lifetime.signal } as never)
  let bubbled = true
  const dispatch = (target: EventTarget, at: ElementFixture = root) => {
    const event = Object.assign(new Event('click', { cancelable: true, bubbles: true }), { button: 0 })
    Object.defineProperty(event, 'target', { value: target })
    at.dispatchEvent(event)
    bubbled = !event.cancelBubble
    return event.defaultPrevented
  }
  /** Follows a link; `row` makes it that row's link. */
  const click = (href: string, options: { row?: string } = {}) =>
    dispatch(new AnchorFixture(new URL(href, origin).href, options.row))
  const back = (steps = 1) => {
    position -= steps
    current = new URL(entries[position]!)
    const event = new CustomEvent('ket:popstate', { cancelable: true })
    doc.dispatchEvent(event)
    return event.defaultPrevented
  }
  /** What the reader types into the search field, as one `input` event. */
  const type = (id: string, value: string) => {
    const event = new Event('input', { bubbles: true })
    Object.defineProperty(event, 'target', { value: { id, value } })
    controlsRoot.dispatchEvent(event)
  }
  return {
    html: () => markup,
    reads,
    writes,
    calls,
    entries: () => entries.slice(),
    location: () => `${current.pathname}${current.search}`,
    hash: () => current.hash,
    click,
    retry: (id: string) => dispatch(new ButtonFixture(id)),
    bubbled: () => bubbled,
    back,
    type,
    online,
    /** A text field of the page, by id, as the reader left it. */
    field: (id: string) => {
      const known = (fields.get(id) as { value: string } | undefined) ?? { value: '' }
      fields.set(id, known)
      return known
    },
    /** A server-rendered form of the page, by id, and its `returnTo` field. */
    form: (id: string, returnTo = '') => {
      const field = { value: returnTo }
      fields.set(id, { elements: { namedItem: (name: string) => (name === 'returnTo' ? field : null) } })
      return field
    },
    /** A button anywhere in the page that names `form`, as the reader presses it. */
    press: (name: string, form: string) => {
      const button = { name, getAttribute: (key: string) => (key === 'form' ? form : null) }
      const event = new Event('click', { bubbles: true })
      Object.defineProperty(event, 'target', { value: { closest: () => button } })
      doc.dispatchEvent(event)
    },
    document: doc,
    window: win,
    reply: (next: Reply) => {
      reply = next
    },
    callReply: (next: (path: string, body: unknown) => unknown) => {
      callReply = next
    },
  }
}
