import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachDatePickers } from '../packages/design-system/src/forms/date-time/runtime.js'

test('date-time runtime: a mounted compound control follows later disabled and readonly changes and disposes its observer', () => {
  class Element extends EventTarget {
    dataset: Record<string, string> = {}
    hidden = false
    attributes = new Map<string, string>()
    nodes = new Map<string, Element>()
    controls: Element[] = []
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    }
    removeAttribute(name: string) {
      this.attributes.delete(name)
    }
    querySelector(name: string) {
      return this.nodes.get(name) ?? null
    }
    querySelectorAll(name: string) {
      return name === 'input,button' ? this.controls : []
    }
    matches(name: string) {
      return name === '[data-date-mode]' && !!this.dataset.dateMode
    }
    contains(node: unknown) {
      return node === this || this.controls.includes(node as Element)
    }
  }
  class Input extends Element {
    id = ''
    type = 'text'
    value = ''
    disabled = false
    readOnly = false
    form = null
    validationMessage = ''
    cloneNode() {
      const copy = new Input()
      copy.type = this.type
      return copy
    }
    setCustomValidity(message: string) {
      this.validationMessage = message
    }
  }
  class Button extends Element {
    disabled = false
  }
  const observers: Observer[] = []
  class Observer {
    target: unknown
    disconnected = false
    callback: () => void
    options?: MutationObserverInit
    constructor(callback: () => void) {
      this.callback = callback
      observers.push(this)
    }
    observe(target: unknown, options?: MutationObserverInit) {
      this.target = target
      this.options = options
    }
    deliver(attributeName: string) {
      if (
        !this.disconnected &&
        this.options?.attributes &&
        (!this.options.attributeFilter || this.options.attributeFilter.includes(attributeName))
      )
        this.callback()
    }
    disconnect() {
      this.disconnected = true
    }
  }
  const globals: Record<string, unknown> = {
    HTMLElement: Element,
    Node: Element,
    HTMLInputElement: Input,
    HTMLButtonElement: Button,
    MutationObserver: Observer,
  }
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const picker = new Element(),
    input = new Input(),
    day = new Input(),
    time = new Input(),
    parts = new Element(),
    open = new Button()
  picker.dataset.dateMode = 'datetime'
  input.type = 'datetime-local'
  input.value = '2026-10-13T12:00'
  day.type = 'date'
  day.value = '2026-10-13'
  time.type = 'time'
  time.value = '12:00'
  parts.hidden = true
  picker.nodes.set('input[type="datetime-local"]', input)
  picker.nodes.set('input[type="date"]', day)
  picker.nodes.set('input[type="time"]', time)
  picker.nodes.set('[data-ui="date-time-parts"]', parts)
  parts.controls = [day, time, open]
  let cleanup: (() => void) | undefined
  try {
    cleanup = attachDatePickers(picker as unknown as ParentNode)
    assert.equal(input.type, 'hidden')
    assert.equal(parts.hidden, false)
    assert.equal(time.disabled, false)
    const observed = observers.find((observer) => observer.target === input)
    assert.ok(observed, 'canonical state must be observed after enhancement')
    input.disabled = true
    observed.deliver('disabled')
    assert.equal(day.disabled, true)
    assert.equal(time.disabled, true)
    assert.equal(open.disabled, true)
    input.disabled = false
    input.readOnly = true
    observed.deliver('disabled')
    observed.deliver('readonly')
    assert.equal(day.disabled, false)
    assert.equal(day.readOnly, true)
    assert.equal(time.readOnly, true)
    assert.equal(open.disabled, true)
    input.readOnly = false
    observed.deliver('readonly')
    assert.equal(time.readOnly, false)
    assert.equal(open.disabled, false)
    cleanup()
    cleanup = undefined
    assert.equal(observed.disconnected, true)
    assert.equal(input.type, 'datetime-local')
    assert.equal(parts.hidden, true)
  } finally {
    cleanup?.()
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
