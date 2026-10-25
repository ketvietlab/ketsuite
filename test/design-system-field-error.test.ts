import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Field } from '@ketvietlab/design-system'
import { clearFieldError, showFieldError } from '../packages/design-system/src/runtime/field-error.js'

// The helper only walks, reads and writes attributes, so a few fake elements stand in for the DOM.
// What the message looks like and how it reads is checked against Field's own rendering.
type Listener = (event: { type: string }) => void

class Fake {
  readonly tag: string
  parentElement: Fake | null = null
  children: Fake[] = []
  attributes = new Map<string, string>()
  textContent = ''
  listeners = new Map<string, Set<Listener>>()
  focused = false
  ownerDocument = { createElement: (tag: string) => new Fake(tag) }
  constructor(tag: string, attributes: Record<string, string> = {}, children: Fake[] = []) {
    this.tag = tag
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value)
    for (const child of children) this.append(child)
  }
  get id(): string {
    return this.attributes.get('id') ?? ''
  }
  set id(value: string) {
    this.attributes.set('id', value)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  append(child: Fake): void {
    child.parentElement = this
    this.children.push(child)
  }
  remove(): void {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
  matches(selector: string): boolean {
    return selector
      .split(',')
      .map((part) => /\[data-ui="([^"]+)"\]/u.exec(part)?.[1])
      .includes(this.getAttribute('data-ui') ?? undefined)
  }
  closest(selector: string): Fake | null {
    for (let node: Fake | null = this; node; node = node.parentElement)
      if (node.matches(selector)) return node
    return null
  }
  querySelectorAll(selector: string): Fake[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }
  /** Bubbles like an input or change event from a control. */
  dispatch(type: string): void {
    for (let node: Fake | null = this; node; node = node.parentElement)
      for (const listener of [...(node.listeners.get(type) ?? [])]) listener({ type })
  }
  focus(): void {
    this.focused = true
  }
  get outerHTML(): string {
    const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${value}"`).join('')
    return `<${this.tag}${attributes}>${this.textContent}${this.children.map((child) => child.outerHTML).join('')}</${this.tag}>`
  }
}

const textField = () => {
  const control = new Fake('input', {
    'data-ui': 'field-control',
    id: 'ext',
    'aria-describedby': 'ext-help',
  })
  const field = new Fake('div', { 'data-ui': 'field', 'data-invalid': 'false' }, [
    new Fake('label', { 'data-ui': 'field-label', for: 'ext' }),
    control,
    new Fake('small', { 'data-ui': 'field-help', id: 'ext-help' }),
  ])
  return { field, control }
}

const errorOf = (field: Fake) =>
  field.children.find((child) => child.getAttribute('data-ui') === 'field-error')
const unmark = (html: string) => html.replace(/<!--.*?-->/gu, '')

test('field error: the message is the one Field renders, in the same place, and the next edit takes it away', () => {
  const { field, control } = textField()
  const clear = showFieldError(control as unknown as HTMLElement, 'Số 1011 đã có người dùng')
  const error = errorOf(field)
  assert.ok(error)
  assert.equal(field.children.at(-1), error, 'after the help, where Field renders its error')
  const rendered = unmark(
    renderToString(Field({ id: 'ext', name: 'ext', label: 'Số', error: 'Số 1011 đã có người dùng' })),
  )
  assert.ok(rendered.includes(error.outerHTML), `${error.outerHTML} is not in ${rendered}`)
  assert.equal(field.getAttribute('data-invalid'), 'true')
  assert.equal(control.getAttribute('aria-invalid'), 'true')
  assert.equal(control.getAttribute('aria-describedby'), 'ext-help ext-error')
  assert.equal(control.focused, true, 'focus brings the control and its message to a screen reader')

  control.dispatch('input')
  assert.equal(errorOf(field), undefined)
  assert.equal(field.getAttribute('data-invalid'), 'false')
  assert.equal(control.getAttribute('aria-invalid'), null)
  assert.equal(control.getAttribute('aria-describedby'), 'ext-help')
  assert.equal(field.listeners.get('input')?.size, 0, 'no listener is left behind')
  clear()
  assert.equal(control.getAttribute('aria-describedby'), 'ext-help', 'clearing twice changes nothing')
})

test('field error: a choice group marks the group and every choice, and a second message replaces the first', () => {
  const choices = ['missed', 'forward'].map(
    (value) => new Fake('input', { 'data-ui': 'field-option-input', type: 'radio', value }),
  )
  const options = new Fake(
    'div',
    { 'data-ui': 'field-options', role: 'radiogroup', 'aria-labelledby': 'after-label' },
    choices.map((choice) => new Fake('label', { 'data-ui': 'field-option' }, [choice])),
  )
  const field = new Fake('div', { 'data-ui': 'field', 'data-invalid': 'false' }, [
    new Fake('span', { 'data-ui': 'field-label', id: 'after-label' }),
    options,
  ])
  showFieldError(choices[0] as unknown as HTMLElement, 'Chọn một cách xử lý', { focus: false })
  showFieldError(choices[0] as unknown as HTMLElement, 'Chọn người nhận cuộc gọi chuyển tới', {
    focus: false,
  })
  const errors = field.children.filter((child) => child.getAttribute('data-ui') === 'field-error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].id, 'after-error', 'named after the group, as Field names it')
  assert.match(errors[0].outerHTML, /Chọn người nhận cuộc gọi chuyển tới/u)
  for (const target of [options, ...choices]) {
    assert.equal(target.getAttribute('aria-invalid'), 'true')
    assert.equal(target.getAttribute('aria-describedby'), 'after-error')
  }
  assert.equal(choices[0].focused, false)

  choices[1].dispatch('change')
  assert.equal(errorOf(field), undefined)
  for (const target of [options, ...choices]) {
    assert.equal(target.getAttribute('aria-invalid'), null)
    assert.equal(target.getAttribute('aria-describedby'), null)
  }
})

test('field error: clearing also removes an error the Field was rendered with', () => {
  const { field, control } = textField()
  field.setAttribute('data-invalid', 'true')
  control.setAttribute('aria-invalid', 'true')
  control.setAttribute('aria-describedby', 'ext-help ext-error')
  field.append(new Fake('small', { 'data-ui': 'field-error', id: 'ext-error' }))
  clearFieldError(control as unknown as HTMLElement)
  assert.equal(errorOf(field), undefined)
  assert.equal(field.getAttribute('data-invalid'), 'false')
  assert.equal(control.getAttribute('aria-invalid'), null)
  assert.equal(control.getAttribute('aria-describedby'), 'ext-help')
  // A control outside any Field has nowhere to show a message.
  const loose = new Fake('input', { id: 'loose' })
  assert.doesNotThrow(() => showFieldError(loose as unknown as HTMLElement, 'x')())
})

test('field error: a check that answers while typing leaves focus alone and is read out as an alert', () => {
  const { field, control } = textField()
  showFieldError(control as unknown as HTMLElement, 'Email đã được sử dụng.', {
    focus: false,
    announce: true,
  })
  const error = errorOf(field)
  assert.equal(error?.getAttribute('role'), 'alert')
  assert.equal(control.focused, false)
  assert.equal(control.getAttribute('aria-invalid'), 'true')
  showFieldError(control as unknown as HTMLElement, 'Số 1011 đã có người dùng')
  assert.equal(errorOf(field)?.getAttribute('role'), null, 'a message after a submit stays a plain error')
})
