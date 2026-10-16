import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordForm } from '@ketvietlab/design-system'
import { attachApplyOnInput } from '../packages/design-system/src/runtime/apply-on-input.js'

const filterForm = (applyOnInput: boolean) =>
  renderToString(
    <RecordForm
      id="line-filter"
      action="/lines"
      method="get"
      applyOnInput={applyOnInput}
      submitLabel="Filter"
      submitVariant="secondary"
      fields={[{ id: 'line-q', name: 'q', label: 'Search', type: 'search' }]}
    />,
  )

test('RecordForm applyOnInput marks the form for the runtime and drops the visible submit step', () => {
  const markup = filterForm(true)
  assert.match(markup, /<form[^>]*data-apply="input"/)
  assert.doesNotMatch(markup, /data-ui="form-actions"/)
  assert.doesNotMatch(markup, /data-ui="button"/)
  // Enter still applies at once through the hidden default button.
  assert.match(markup, /<button[^>]*type="submit"[^>]*hidden/)
  const classic = filterForm(false)
  assert.doesNotMatch(classic, /data-apply=/)
  assert.match(classic, /data-ui="form-actions"/)
})

// The runtime needs a few DOM objects, not a renderer; the consumer screen carries the browser evidence.
type Listener = (event: { type: string; target: unknown }) => void
const FORM = 'form[data-ui="record-form"][data-apply="input"]'

class FakeForm {
  submits = 0
  readonly id: string
  readonly auto: boolean
  constructor(id: string, auto: boolean) {
    this.id = id
    this.auto = auto
  }
  matches(selector: string): boolean {
    return this.auto && selector === FORM
  }
  requestSubmit(): void {
    this.submits += 1
  }
}

class FakeField {
  focused = false
  isConnected = true
  selection: [number, number] | null = null
  readonly id: string
  readonly tagName: string
  readonly type: string
  readonly form: FakeForm
  value = ''
  constructor(id: string, tagName: string, type: string, form: FakeForm) {
    this.id = id
    this.tagName = tagName
    this.type = type
    this.form = form
  }
  focus(): void {
    this.focused = true
    doc.activeElement = this
  }
  setSelectionRange(start: number, end: number): void {
    this.selection = [start, end]
  }
}

class FakeDocument {
  body = { tagName: 'BODY' }
  activeElement: unknown = this.body
  listeners: Record<string, Listener[]> = {}
  fields = new Map<string, FakeField>()
  addEventListener(type: string, listener: Listener): void {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
  }
  getElementById(id: string): FakeField | null {
    return this.fields.get(id) ?? null
  }
  dispatch(type: string, target: unknown): void {
    const event = { type, target }
    for (const listener of this.listeners[type] ?? []) listener(event)
  }
}

class FakeStorage {
  items = new Map<string, string>()
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
}

let doc: FakeDocument
let storage: FakeStorage
let form: FakeForm
let search: FakeField
let facet: FakeField
const attach = () => attachApplyOnInput(doc as unknown as Document, storage)

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  doc = new FakeDocument()
  storage = new FakeStorage()
  form = new FakeForm('line-filter', true)
  search = new FakeField('line-q', 'INPUT', 'search', form)
  facet = new FakeField('line-facet', 'SELECT', 'select-one', form)
  doc.fields.set(search.id, search)
  doc.fields.set(facet.id, facet)
})
afterEach(() => {
  mock.timers.reset()
  delete (globalThis as { MutationObserver?: unknown }).MutationObserver
})

test('apply on input: a choice submits at once, typing after a pause, Enter cancels the pending pause', () => {
  const detach = attach()
  doc.dispatch('change', facet)
  assert.equal(form.submits, 1, 'a chosen option applies at once')

  doc.dispatch('input', search)
  mock.timers.tick(300)
  doc.dispatch('input', search)
  mock.timers.tick(300)
  assert.equal(form.submits, 1, 'every keystroke restarts the pause')
  mock.timers.tick(100)
  assert.equal(form.submits, 2, 'typed text applies after the pause')
  // The blur `change` of a typed field is not a second submit.
  doc.dispatch('change', search)
  mock.timers.tick(1000)
  assert.equal(form.submits, 2)

  doc.dispatch('input', search)
  doc.dispatch('submit', form)
  mock.timers.tick(1000)
  assert.equal(form.submits, 2, 'an Enter submit cancels the pending pause submit')

  detach()
  doc.dispatch('change', facet)
  assert.equal(form.submits, 2, 'detached listeners no longer submit')
})

test('apply on input: other forms keep their submit step, a second attach submits once', () => {
  const classic = new FakeForm('order', false)
  attach()
  attach()
  doc.dispatch('change', new FakeField('state', 'SELECT', 'select-one', classic))
  doc.dispatch('input', new FakeField('note', 'INPUT', 'text', classic))
  mock.timers.tick(1000)
  assert.equal(classic.submits, 0)
  doc.dispatch('change', facet)
  assert.equal(form.submits, 1)
})

test('apply on input: a reloading submit gives the typed field focus back with the caret at the end', () => {
  attach()
  doc.dispatch('input', search)
  mock.timers.tick(400)
  assert.equal(form.submits, 1)

  // The next page attaches the runtime; the same field now holds the applied text.
  search.value = 'PC-10'
  attach()
  assert.equal(search.focused, true)
  assert.deepEqual(search.selection, [5, 5])

  // Focus is restored once, and never from a stale entry.
  search.focused = false
  attach()
  assert.equal(search.focused, false)
  doc.dispatch('input', search)
  mock.timers.tick(400)
  mock.timers.tick(10_000)
  attach()
  assert.equal(search.focused, false)
})

// An island redrawing the form in place: every DOM change reaches the observer callbacks.
let observers: { callback: () => void; on: boolean }[] = []
const redraw = () => {
  for (const observer of observers.filter((item) => item.on)) observer.callback()
}
const observeMutations = () => {
  observers = []
  ;(globalThis as { MutationObserver?: unknown }).MutationObserver = class {
    entry: { callback: () => void; on: boolean }
    constructor(callback: () => void) {
      this.entry = { callback, on: false }
      observers.push(this.entry)
    }
    observe(): void {
      this.entry.on = true
    }
    disconnect(): void {
      this.entry.on = false
    }
  }
}
const replaceSearch = (value: string | null) => {
  search.isConnected = false
  if (doc.activeElement === search) doc.activeElement = doc.body
  doc.fields.delete(search.id)
  if (value === null) return null
  const fresh = new FakeField(search.id, 'INPUT', 'search', form)
  fresh.value = value
  doc.fields.set(fresh.id, fresh)
  return fresh
}

test('apply on input: an island redrawing the form in place gives the new field focus, after any loading state', () => {
  observeMutations()
  attach()
  search.focus()
  doc.dispatch('input', search)
  mock.timers.tick(400)
  assert.equal(form.submits, 1)
  redraw()
  replaceSearch(null)
  redraw()
  const fresh = replaceSearch('PC-10') as FakeField
  redraw()
  assert.equal(fresh.focused, true)
  assert.deepEqual(fresh.selection, [5, 5])
  assert.equal(
    storage.getItem('kv.design-system.apply-on-input.focus'),
    null,
    'a later reload does not refocus',
  )
})

test('apply on input: focus is not pulled back once the reader has left the typed field', () => {
  observeMutations()
  attach()
  search.focus()
  doc.dispatch('input', search)
  mock.timers.tick(400)
  doc.activeElement = doc.body
  redraw()
  const fresh = replaceSearch('PC-10') as FakeField
  redraw()
  assert.equal(fresh.focused, false)
})
